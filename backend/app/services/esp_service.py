import os
from pathlib import Path

import httpx
from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env", override=True)

ESP32_IP = os.getenv("ESP32_IP", "http://172.20.10.4")
ESP32_TIMEOUT_SECONDS = 2
_latest_esp32_ip = ESP32_IP

CURRENT_ENDPOINT_PINS = {12, 21, 25, 26, 27, 32}


def set_esp32_ip_from_host(host: str | None) -> None:
    global _latest_esp32_ip

    if not host:
        return

    _latest_esp32_ip = f"http://{host}"


def get_esp32_ip() -> str:
    return _latest_esp32_ip


def _device_text(
    name: str | None,
    device_type: str | None,
    room: str | None
) -> str:
    return " ".join(
        value.lower()
        for value in (name, device_type, room)
        if value
    )


def resolve_device_endpoint_pin(
    pin: int,
    name: str | None = None,
    device_type: str | None = None,
    room: str | None = None
) -> int:
    if pin in CURRENT_ENDPOINT_PINS:
        return pin

    text = _device_text(name, device_type, room)

    if "door" in text or "entrance" in text:
        return 21

    if (
        "clothes" in text
        or "laundry" in text
        or "phoi" in text
        or "phơi" in text
    ):
        return 12

    if "light" not in text:
        return pin

    if "living" in text or "phong khach" in text:
        return 25
    if "kitchen" in text or "bep" in text:
        return 26
    if "bedroom" in text or "phong ngu" in text:
        return 27
    if "bathroom" in text or "phong tam" in text:
        return 32

    return pin


async def send_command(pin: int, action: str):
    url = f"{get_esp32_ip()}/device/{pin}/{action}"
    print(f"ESP32 request: GET {url}")

    async with httpx.AsyncClient(timeout=ESP32_TIMEOUT_SECONDS) as client:
        response = await client.get(url)

    response.raise_for_status()

    try:
        return response.json()
    except ValueError:
        return {"message": response.text}


async def set_automatic_light(action: str):
    url = f"{get_esp32_ip()}/automatic-light/{action}"
    print(f"ESP32 request: GET {url}")

    async with httpx.AsyncClient(timeout=ESP32_TIMEOUT_SECONDS) as client:
        response = await client.get(url)

    response.raise_for_status()

    return response.json()


async def get_automatic_light_status():
    url = f"{get_esp32_ip()}/automatic-light/status"
    print(f"ESP32 request: GET {url}")

    async with httpx.AsyncClient(timeout=ESP32_TIMEOUT_SECONDS) as client:
        response = await client.get(url)

    response.raise_for_status()

    return response.json()


async def set_automatic_clothes(action: str):
    url = f"{get_esp32_ip()}/automatic-clothes/{action}"
    print(f"ESP32 request: GET {url}")

    async with httpx.AsyncClient(timeout=ESP32_TIMEOUT_SECONDS) as client:
        response = await client.get(url)

    response.raise_for_status()

    return response.json()


async def get_automatic_clothes_status():
    url = f"{get_esp32_ip()}/automatic-clothes/status"
    print(f"ESP32 request: GET {url}")

    async with httpx.AsyncClient(timeout=ESP32_TIMEOUT_SECONDS) as client:
        response = await client.get(url)

    response.raise_for_status()

    return response.json()
