import unicodedata

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
import httpx
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.database import get_db
from app.models.device import Device
from app.schemas.assistant_schema import (
    VoiceCommandRequest,
    VoiceCommandResponse
)
from app.services.esp_service import (
    resolve_device_endpoint_pin,
    send_command,
    set_all_indoor_lights,
    set_automatic_clothes,
    set_automatic_light,
    set_automatic_yard_light
)
from app.services.gemini_service import (
    GeminiCommandError,
    parse_device_audio_command,
    parse_device_command
)

router = APIRouter(
    prefix="/assistant",
    tags=["Assistant"]
)

INDOOR_LIGHT_ENDPOINT_PINS = {25, 26, 27, 32}


def _normalize_text(value: str | None) -> str:
    if not value:
        return ""

    for encoding in ("cp1252", "latin1"):
        try:
            repaired = value.encode(encoding).decode("utf-8")
        except UnicodeError:
            continue

        if repaired != value:
            value = repaired
            break

    text = unicodedata.normalize("NFD", value.lower())
    text = "".join(
        char for char in text
        if unicodedata.category(char) != "Mn"
    )
    text = text.replace("đ", "d")

    return text.replace("đ", "d").strip()


def _contains_any(text: str, phrases: tuple[str, ...]) -> bool:
    return any(phrase in text for phrase in phrases)


def _parse_local_command(command: str, devices: list[Device]) -> dict | None:
    normalized_command = _normalize_text(command)
    action_text = normalized_command.replace("che do tu dong", "")
    action_text = action_text.replace("tu dong", "")
    action_text = action_text.replace("automatic", "")

    if _contains_any(action_text, ("tat", "dong", "thu", "keo vao", "off")):
        action = "off"
    elif _contains_any(action_text, ("bat", "mo", "keo ra", "on")):
        action = "on"
    else:
        return None

    wants_all = any(
        phrase in normalized_command
        for phrase in (
            "tat ca",
            "toan bo",
            "het",
            "4 den",
            "bon den",
            "cac den trong nha",
            "den trong nha"
        )
    )
    wants_light = any(
        word in normalized_command
        for word in ("den", "light")
    )
    wants_automation = _contains_any(
        normalized_command,
        ("tu dong", "auto", "automatic", "che do tu dong")
    )
    wants_yard = _contains_any(
        normalized_command,
        ("san", "san nha", "ngoai troi", "yard", "garden", "outdoor")
    )
    wants_clothesline = _contains_any(
        normalized_command,
        (
            "phoi",
            "gian phoi",
            "day phoi",
            "quan ao",
            "do phoi",
            "clothes",
            "clothesline",
            "laundry"
        )
    )

    if wants_automation:
        automation = None

        if wants_clothesline:
            automation = "clothes"
        elif wants_yard:
            automation = "yard_light"
        elif wants_light:
            automation = "light"

        if automation:
            return {
                "action": action,
                "automation": automation,
                "confidence": 0.95,
                "message": "Da hieu lenh dieu khien che do tu dong."
            }

    if wants_all and wants_light:
        light_devices = [
            device for device in devices
            if resolve_device_endpoint_pin(
                device.pin,
                device.name,
                device.type,
                device.room
            ) in INDOOR_LIGHT_ENDPOINT_PINS
        ]

        if light_devices:
            return {
                "action": action,
                "device_ids": [device.id for device in light_devices],
                "confidence": 0.95,
                "message": "Da hieu lenh dieu khien tat ca den."
            }

    if wants_all:
        return {
            "action": action,
            "device_ids": [device.id for device in devices],
            "confidence": 0.9,
            "message": "Da hieu lenh dieu khien tat ca thiet bi."
        }

    room_aliases = {
        "phong khach": ("phong khach", "living room", "living"),
        "phong ngu": ("phong ngu", "bedroom", "bed room"),
        "nha bep": ("nha bep", "bep", "kitchen"),
        "phong tam": ("phong tam", "bathroom", "bath room"),
        "cua vao": ("cua vao", "cua", "door", "entrance"),
        "san nha": ("san nha", "san", "yard", "outdoor", "garden", "ban cong", "balcony"),
    }

    requested_rooms = [
        room
        for room, aliases in room_aliases.items()
        if any(alias in normalized_command for alias in aliases)
    ]

    scored_devices = []

    for device in devices:
        device_text = " ".join(
            [
                _normalize_text(device.name),
                _normalize_text(device.type),
                _normalize_text(device.room),
            ]
        )

        score = 0
        room_matches = [
            room for room in requested_rooms
            if room in device_text
        ]
        special_pin_match = (
            (wants_clothesline and device.pin == 14)
            or (wants_yard and device.pin == 33)
            or (
                _contains_any(normalized_command, ("cua", "door", "cong"))
                and device.pin == 21
            )
        )

        if requested_rooms and not room_matches and not special_pin_match:
            continue

        for token in normalized_command.split():
            if len(token) >= 2 and token in device_text:
                score += 1

        if "den" in normalized_command and "den" in device_text:
            score += 3
        if "light" in normalized_command and "light" in device_text:
            score += 3
        if "quat" in normalized_command and "quat" in device_text:
            score += 3
        if "fan" in normalized_command and "fan" in device_text:
            score += 3
        if "tivi" in normalized_command and "tivi" in device_text:
            score += 3
        if "tv" in normalized_command and "tv" in device_text:
            score += 3
        if wants_clothesline and _contains_any(
            device_text,
            (
                "phoi",
                "gian phoi",
                "day phoi",
                "quan ao",
                "clothes",
                "clothesline",
                "laundry"
            )
        ):
            score += 8
        if wants_clothesline and device.pin == 14:
            score += 8
        if wants_yard and _contains_any(
            device_text,
            ("san", "yard", "outdoor", "garden", "ngoai troi")
        ):
            score += 5
        if wants_yard and device.pin == 33:
            score += 6
        if _contains_any(normalized_command, ("cua", "door", "cong")) and _contains_any(
            device_text,
            ("cua", "door", "entrance", "cong")
        ):
            score += 8
        if _contains_any(normalized_command, ("cua", "door", "cong")) and device.pin == 21:
            score += 8

        score += len(room_matches) * 6

        if score > 0:
            scored_devices.append((score, device))

    if not scored_devices:
        return None

    scored_devices.sort(key=lambda item: item[0], reverse=True)
    device = scored_devices[0][1]

    return {
        "action": action,
        "device_id": device.id,
        "confidence": 0.9,
        "message": "Da hieu lenh dieu khien thiet bi."
    }


async def _get_device_context(db: Session):
    devices = await run_in_threadpool(lambda: db.query(Device).all())

    device_context = [
        {
            "id": device.id,
            "name": device.name,
            "type": device.type,
            "room": device.room,
            "status": device.status
        }
        for device in devices
    ]

    return devices, device_context


async def _execute_parsed_command(
    parsed: dict,
    command: str,
    devices: list[Device],
    db: Session
):
    action = parsed.get("action")
    device_id = parsed.get("device_id")
    device_ids = parsed.get("device_ids")
    automation = parsed.get("automation")

    if action in ("on", "off") and automation:
        automation_handlers = {
            "light": set_automatic_light,
            "clothes": set_automatic_clothes,
            "yard_light": set_automatic_yard_light
        }
        handler = automation_handlers.get(str(automation))

        if not handler:
            return VoiceCommandResponse(
                message="Khong hieu che do tu dong can dieu khien.",
                command=command
            )

        try:
            result = await handler(action)
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=504,
                detail="ESP32 did not respond"
            ) from exc

        return VoiceCommandResponse(
            message=(
                f"Da {'bat' if action == 'on' else 'tat'} "
                "che do tu dong."
            ),
            command=command,
            action=action,
            status=bool(result.get("automatic"))
        )

    if action not in ("on", "off") or not (device_id or device_ids):
        return VoiceCommandResponse(
            message=parsed.get(
                "message",
                "Khong hieu lenh dieu khien thiet bi."
            ),
            command=command
        )

    if device_ids:
        target_ids = [int(id_value) for id_value in device_ids]
        target_devices = [
            item for item in devices
            if item.id in target_ids
        ]

        if not target_devices:
            raise HTTPException(
                status_code=404,
                detail="Device not found"
            )

        try:
            devices_with_endpoint_pins = [
                (
                    device,
                    resolve_device_endpoint_pin(
                        device.pin,
                        device.name,
                        device.type,
                        device.room
                    )
                )
                for device in target_devices
            ]
            endpoint_pins = {
                endpoint_pin
                for _, endpoint_pin in devices_with_endpoint_pins
            }
            bulk_indoor_lights = (
                INDOOR_LIGHT_ENDPOINT_PINS.issubset(endpoint_pins)
            )

            if bulk_indoor_lights:
                await set_all_indoor_lights(action)

                for device, endpoint_pin in devices_with_endpoint_pins:
                    if endpoint_pin in INDOOR_LIGHT_ENDPOINT_PINS:
                        device.status = action == "on"

            for device, endpoint_pin in devices_with_endpoint_pins:
                if bulk_indoor_lights and endpoint_pin in INDOOR_LIGHT_ENDPOINT_PINS:
                    continue

                await send_command(endpoint_pin, action)
                device.status = action == "on"
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=504,
                detail="ESP32 did not respond"
            ) from exc

        await run_in_threadpool(db.commit)

        return VoiceCommandResponse(
            message=(
                f"Da {'bat' if action == 'on' else 'tat'} "
                f"{len(target_devices)} thiet bi."
            ),
            command=command,
            action=action,
            status=action == "on"
        )

    device = next(
        (item for item in devices if item.id == int(device_id)),
        None
    )

    if not device:
        raise HTTPException(
            status_code=404,
            detail="Device not found"
        )

    try:
        endpoint_pin = resolve_device_endpoint_pin(
            device.pin,
            device.name,
            device.type,
            device.room
        )
        await send_command(endpoint_pin, action)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=504,
            detail="ESP32 did not respond"
        ) from exc

    status = action == "on"
    device.status = status

    await run_in_threadpool(db.commit)

    return VoiceCommandResponse(
        message=(
            f"Da {'bat' if status else 'tat'} "
            f"{device.name} {device.room}."
        ),
        command=command,
        device_id=device.id,
        device_name=device.name,
        action=action,
        status=status
    )


@router.post("/voice-command", response_model=VoiceCommandResponse)
async def handle_voice_command(
    body: VoiceCommandRequest,
    db: Session = Depends(get_db)
):
    command = body.command.strip()

    if not command:
        raise HTTPException(
            status_code=400,
            detail="Command is required"
        )

    devices, device_context = await _get_device_context(db)
    parsed = _parse_local_command(command, devices)

    if not parsed:
        try:
            parsed = await parse_device_command(command, device_context)
        except GeminiCommandError as exc:
            raise HTTPException(
                status_code=500,
                detail=str(exc)
            ) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail="Gemini API did not respond"
            ) from exc

    return await _execute_parsed_command(parsed, command, devices, db)


@router.post("/voice-audio", response_model=VoiceCommandResponse)
async def handle_voice_audio(
    audio: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    if not audio.content_type or not audio.content_type.startswith("audio/"):
        raise HTTPException(
            status_code=400,
            detail="Audio file is required"
        )

    audio_bytes = await audio.read()

    if not audio_bytes:
        raise HTTPException(
            status_code=400,
            detail="Audio file is empty"
        )

    devices, device_context = await _get_device_context(db)

    try:
        parsed = await parse_device_audio_command(
            audio_bytes,
            audio.content_type,
            device_context
        )
    except GeminiCommandError as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc)
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail="Gemini API did not respond"
        ) from exc

    command = parsed.get("transcript") or "voice audio"

    return await _execute_parsed_command(parsed, command, devices, db)
