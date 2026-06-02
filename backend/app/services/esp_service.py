import httpx


ESP32_IP = "http://192.168.1.51"


async def send_command(pin: int, action: str):
    url = f"{ESP32_IP}/device/{pin}/{action}"

    async with httpx.AsyncClient(timeout=2) as client:
        response = await client.get(url)

    response.raise_for_status()

    return response.text
