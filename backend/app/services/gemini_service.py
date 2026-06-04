import json
import os
import re
import base64
from pathlib import Path

import httpx
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/"
    f"models/{GEMINI_MODEL}:generateContent"
)


class GeminiCommandError(Exception):
    pass


def _gemini_error_message(response: httpx.Response) -> str:
    try:
        data = response.json()
    except ValueError:
        data = {}

    message = (
        data.get("error", {}).get("message")
        if isinstance(data, dict)
        else None
    )

    if message:
        return f"Gemini API error {response.status_code}: {message}"

    return f"Gemini API error {response.status_code}"


def _raise_for_gemini_response(response: httpx.Response) -> None:
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise GeminiCommandError(_gemini_error_message(response)) from exc


def _extract_json(text: str) -> dict:
    cleaned = text.strip()

    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)

        if not match:
            raise GeminiCommandError("Gemini did not return JSON")

        return json.loads(match.group(0))


async def parse_device_command(command: str, devices: list[dict]) -> dict:
    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        raise GeminiCommandError("Missing GEMINI_API_KEY")

    prompt = f"""
You are a smart home command parser for Vietnamese voice commands.
Return only valid JSON. Do not include markdown.

Allowed actions:
- "on" for bat/mo
- "off" for tat/dong

Available devices:
{json.dumps(devices, ensure_ascii=False)}

User command:
{command}

Return this exact JSON shape:
{{
  "action": "on" | "off" | null,
  "device_id": number | null,
  "device_ids": [number] | null,
  "confidence": 0.0-1.0,
  "message": "short Vietnamese explanation"
}}

Rules:
- Match device by name, type, and room.
- Example: "bat den phong khach" should choose the light in living room.
- If the user asks for all lights/devices, use device_ids and set device_id to null.
- If the command is unclear or no device matches, use null for action/device_id.
"""

    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": prompt
                    }
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json"
        }
    }

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            GEMINI_API_URL,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": api_key
            },
            json=payload
        )

    _raise_for_gemini_response(response)
    data = response.json()

    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError) as exc:
        raise GeminiCommandError("Gemini returned an invalid response") from exc

    parsed = _extract_json(text)

    if parsed.get("action") not in ("on", "off", None):
        raise GeminiCommandError("Gemini returned an invalid action")

    return parsed


async def parse_device_audio_command(
    audio_bytes: bytes,
    mime_type: str,
    devices: list[dict]
) -> dict:
    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        raise GeminiCommandError("Missing GEMINI_API_KEY")

    prompt = f"""
You are a smart home voice assistant for Vietnamese commands.
Listen to the audio, transcribe the command, and map it to one device.
Return only valid JSON. Do not include markdown.

Allowed actions:
- "on" for bat/mo
- "off" for tat/dong

Available devices:
{json.dumps(devices, ensure_ascii=False)}

Return this exact JSON shape:
{{
  "transcript": "what the user said in Vietnamese",
  "action": "on" | "off" | null,
  "device_id": number | null,
  "device_ids": [number] | null,
  "confidence": 0.0-1.0,
  "message": "short Vietnamese explanation"
}}

Rules:
- Match device by name, type, and room.
- Example: if the user says "bat den phong khach", choose the light in living room.
- If the user asks for all lights/devices, use device_ids and set device_id to null.
- If the audio is unclear or no device matches, use null for action/device_id.
"""

    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": prompt
                    },
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": base64.b64encode(audio_bytes).decode("ascii")
                        }
                    }
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json"
        }
    }

    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            GEMINI_API_URL,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": api_key
            },
            json=payload
        )

    _raise_for_gemini_response(response)
    data = response.json()

    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError) as exc:
        raise GeminiCommandError("Gemini returned an invalid response") from exc

    parsed = _extract_json(text)

    if parsed.get("action") not in ("on", "off", None):
        raise GeminiCommandError("Gemini returned an invalid action")

    return parsed
