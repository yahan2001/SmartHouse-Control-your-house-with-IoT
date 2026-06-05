import os
from pathlib import Path

import httpx
from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env", override=True)

DOOR_COMMAND_TIMEOUT_SECONDS = 4


def get_esp32_door_ip() -> str:
    load_dotenv(BACKEND_DIR / ".env", override=True)
    raw_ip = (
        os.getenv("ESP32_DOOR_IP")
        or os.getenv("ESP_DOOR_IP")
        or "http://10.10.59.152"
    )
    raw_ip = raw_ip.strip().rstrip("/")

    if not raw_ip.startswith("http://") and not raw_ip.startswith("https://"):
        return f"http://{raw_ip}"

    return raw_ip


async def send_door_command(action: str, message: str | None = None) -> dict:
    if action not in ("open", "close", "deny"):
        raise ValueError("Door action must be open, close, or deny")

    params = {}
    if message:
        params["message"] = message

    url = f"{get_esp32_door_ip()}/door/{action}"
    print(f"ESP32 door request: GET {url}")

    async with httpx.AsyncClient(timeout=DOOR_COMMAND_TIMEOUT_SECONDS) as client:
        response = await client.get(url, params=params)

    response.raise_for_status()

    try:
        return response.json()
    except ValueError:
        return {"message": response.text}


async def set_door_password(password: str) -> dict:
    url = f"{get_esp32_door_ip()}/door/password"
    print(f"ESP32 door request: GET {url}")

    async with httpx.AsyncClient(timeout=DOOR_COMMAND_TIMEOUT_SECONDS) as client:
        response = await client.get(url, params={"value": password})

    response.raise_for_status()

    try:
        return response.json()
    except ValueError:
        return {"message": response.text}


async def get_door_status() -> dict:
    url = f"{get_esp32_door_ip()}/door/status"
    print(f"ESP32 door request: GET {url}")

    async with httpx.AsyncClient(timeout=DOOR_COMMAND_TIMEOUT_SECONDS) as client:
        response = await client.get(url)

    response.raise_for_status()

    return response.json()
