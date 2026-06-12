import os
import unicodedata
from pathlib import Path

import httpx
from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env", override=True)

ESP32_IP = os.getenv("ESP32_IP", "http://172.16.1.13")
ESP32_COMMAND_TIMEOUT_SECONDS = 4
ESP32_STATUS_TIMEOUT_SECONDS = 1.5
_latest_esp32_ip = ESP32_IP

CURRENT_ENDPOINT_PINS = {14, 21, 25, 26, 27, 32, 33}
LEGACY_ENDPOINT_PIN_MAP = {
    2: 25,
    6: 26,
    7: 27,
    10: 32,
    5: 21
}


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
    raw_text = " ".join(
        value.lower()
        for value in (name, device_type, room)
        if value
    )

    return (
        unicodedata.normalize("NFD", raw_text)
        .encode("ascii", "ignore")
        .decode("ascii")
    )


def resolve_device_endpoint_pin(
    pin: int,
    name: str | None = None,
    device_type: str | None = None,
    room: str | None = None
) -> int:
    if pin in LEGACY_ENDPOINT_PIN_MAP:
        return LEGACY_ENDPOINT_PIN_MAP[pin]

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
        return 14

    if "light" not in text:
        return pin

    if (
        "yard" in text
        or "outdoor" in text
        or "garden" in text
        or "san" in text
        or "balcony" in text
        or "ban cong" in text
    ):
        return 33

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

    timeout = httpx.Timeout(
        ESP32_COMMAND_TIMEOUT_SECONDS,
        connect=1.0
    )

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(url)

    response.raise_for_status()

    try:
        return response.json()
    except ValueError:
        return {"message": response.text}


async def set_all_indoor_lights(action: str):
    url = f"{get_esp32_ip()}/lights/all/{action}"
    print(f"ESP32 request: GET {url}")

    timeout = httpx.Timeout(
        ESP32_COMMAND_TIMEOUT_SECONDS,
        connect=1.0
    )

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(url)

    response.raise_for_status()

    return response.json()


async def set_automatic_light(action: str):
    url = f"{get_esp32_ip()}/automatic-light/{action}"
    print(f"ESP32 request: GET {url}")

    async with httpx.AsyncClient(timeout=ESP32_COMMAND_TIMEOUT_SECONDS) as client:
        response = await client.get(url)

    response.raise_for_status()

    return response.json()


async def get_automatic_light_status():
    url = f"{get_esp32_ip()}/automatic-light/status"
    print(f"ESP32 request: GET {url}")

    async with httpx.AsyncClient(timeout=ESP32_STATUS_TIMEOUT_SECONDS) as client:
        response = await client.get(url)

    response.raise_for_status()

    return response.json()


async def set_automatic_clothes(action: str):
    url = f"{get_esp32_ip()}/automatic-clothes/{action}"
    print(f"ESP32 request: GET {url}")

    async with httpx.AsyncClient(timeout=ESP32_COMMAND_TIMEOUT_SECONDS) as client:
        response = await client.get(url)

    response.raise_for_status()

    return response.json()


async def get_automatic_clothes_status():
    url = f"{get_esp32_ip()}/automatic-clothes/status"
    print(f"ESP32 request: GET {url}")

    async with httpx.AsyncClient(timeout=ESP32_STATUS_TIMEOUT_SECONDS) as client:
        response = await client.get(url)

    response.raise_for_status()

    return response.json()


async def set_automatic_yard_light(action: str):
    url = f"{get_esp32_ip()}/automatic-yard-light/{action}"
    print(f"ESP32 request: GET {url}")

    async with httpx.AsyncClient(timeout=ESP32_COMMAND_TIMEOUT_SECONDS) as client:
        response = await client.get(url)

    response.raise_for_status()

    return response.json()


async def get_automatic_yard_light_status():
    url = f"{get_esp32_ip()}/automatic-yard-light/status"
    print(f"ESP32 request: GET {url}")

    async with httpx.AsyncClient(timeout=ESP32_STATUS_TIMEOUT_SECONDS) as client:
        response = await client.get(url)

    response.raise_for_status()

    return response.json()
