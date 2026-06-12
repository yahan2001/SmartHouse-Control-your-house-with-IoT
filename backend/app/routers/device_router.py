from fastapi import APIRouter, Depends, HTTPException

import httpx
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.database import get_db

from app.models.device import Device
from app.models.sensor import SensorData

from app.schemas.device_schema import (
    DeviceResponse,
    ControlRequest
)

from app.services.esp_service import (
    get_automatic_clothes_status,
    get_automatic_light_status,
    get_automatic_yard_light_status,
    resolve_device_endpoint_pin,
    send_command,
    set_automatic_clothes,
    set_automatic_light,
    set_automatic_yard_light
)

router = APIRouter(
    prefix="/devices",
    tags=["Devices"]
)

LIGHT_STATUS_PINS = {
    "light1": (25, 2),
    "light2": (26, 6),
    "light3": (27, 7),
    "light4": (32, 10),
    "yardLight": (33,),
}
AUTO_DARK_LIGHT_VALUE = 3000
AUTO_BRIGHT_LIGHT_VALUE = 2900


def sync_light_statuses(db: Session, status_payload: dict):

    for field_name, pins in LIGHT_STATUS_PINS.items():
        status = status_payload.get(field_name)

        if status is None:
            continue

        next_status = bool(status)

        (
            db.query(Device)
            .filter(
                Device.pin.in_(pins),
                Device.status != next_status
            )
            .update(
                {Device.status: next_status},
                synchronize_session=False
            )
        )


def sync_inferred_automatic_light_statuses(db: Session, status_payload: dict):

    if not status_payload.get("automatic"):
        return

    has_explicit_light_status = any(
        field_name in status_payload
        for field_name in LIGHT_STATUS_PINS
    )

    if has_explicit_light_status:
        return

    latest = (
        db.query(SensorData)
        .order_by(SensorData.id.desc())
        .first()
    )

    if not latest or latest.light is None:
        return

    if latest.light > AUTO_DARK_LIGHT_VALUE:
        inferred_status = True
    elif latest.light < AUTO_BRIGHT_LIGHT_VALUE:
        inferred_status = False
    else:
        return

    all_light_pins = [
        pin
        for field_name, pins in LIGHT_STATUS_PINS.items()
        if field_name != "yardLight"
        for pin in pins
    ]

    (
        db.query(Device)
        .filter(
            Device.pin.in_(all_light_pins),
            Device.status != inferred_status
        )
        .update(
            {Device.status: inferred_status},
            synchronize_session=False
        )
    )


def is_light_device(device: Device) -> bool:

    device_type = (device.type or "").lower()
    device_name = (device.name or "").lower()

    return "light" in device_type or "light" in device_name


def is_yard_light_device(device: Device) -> bool:

    device_type = (device.type or "").lower()
    device_name = (device.name or "").lower()
    device_room = (device.room or "").lower()
    text = f"{device_name} {device_type} {device_room}"

    return (
        device.pin == 33
        or (
            ("light" in device_type or "light" in device_name)
            and (
                "yard" in text
                or "outdoor" in text
                or "garden" in text
                or "san" in text
                or "sân" in text
                or "balcony" in text
                or "ban công" in text
                or "ban cong" in text
            )
        )
    )


@router.get("/", response_model=list[DeviceResponse])
async def get_devices(db: Session = Depends(get_db)):

    try:
        clothes_result = await get_automatic_clothes_status()
    except httpx.HTTPError:
        clothes_result = None

    if isinstance(clothes_result, dict):
        clothesline_status = clothes_result.get("clothesline")

        if clothesline_status is not None:
            (
                db.query(Device)
                .filter(
                    Device.pin == 14,
                    Device.status != bool(clothesline_status)
                )
                .update(
                    {Device.status: bool(clothesline_status)},
                    synchronize_session=False
                )
            )
            await run_in_threadpool(db.commit)

    devices = await run_in_threadpool(lambda: db.query(Device).all())

    return devices


@router.get("/clothesline/test/status")
async def read_clothesline_test_status():

    try:
        result = await get_automatic_clothes_status()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=504,
            detail="ESP32 did not respond"
        ) from exc

    return {
        "automatic": bool(result.get("automatic")),
        "raining": result.get("raining"),
        "clothesline": result.get("clothesline")
    }


@router.get("/clothesline/test/{action}")
@router.post("/clothesline/test/{action}")
async def test_clothesline_servo(
    action: str,
    db: Session = Depends(get_db)
):

    if action not in ("on", "off"):
        raise HTTPException(
            status_code=400,
            detail="Action must be 'on' or 'off'"
        )

    try:
        result = await send_command(14, action)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=504,
            detail=f"ESP32 did not respond at /device/14/{action}"
        ) from exc

    clothesline_status = (
        bool(result.get("clothesline"))
        if isinstance(result, dict) and result.get("clothesline") is not None
        else action == "on"
    )

    (
        db.query(Device)
        .filter(
            Device.pin == 14,
            Device.status != clothesline_status
        )
        .update(
            {Device.status: clothesline_status},
            synchronize_session=False
        )
    )
    await run_in_threadpool(db.commit)

    return {
        "message": "success",
        "action": action,
        "pin": 14,
        "status": clothesline_status,
        "esp32": result
    }


@router.post("/{device_id}")

async def control_device(
    device_id: int,
    body: ControlRequest,
    db: Session = Depends(get_db)
):

    device = await run_in_threadpool(
        lambda: db.query(Device).filter(
            Device.id == device_id
        ).first()
    )

    if not device:
        raise HTTPException(
            status_code=404,
            detail="Device not found"
        )

    if body.action not in ("on", "off"):
        raise HTTPException(
            status_code=400,
            detail="Action must be 'on' or 'off'"
        )

    automatic = None
    automatic_yard = None
    manually_controls_yard_light = is_yard_light_device(device)
    manually_controls_light = is_light_device(device)

    if manually_controls_yard_light:
        try:
            auto_result = await set_automatic_yard_light("off")
        except httpx.HTTPError:
            auto_result = None

        if isinstance(auto_result, dict):
            automatic_yard = auto_result.get("automatic", False)

    elif manually_controls_light:
        try:
            auto_result = await set_automatic_light("off")
        except httpx.HTTPError:
            auto_result = None

        if isinstance(auto_result, dict):
            automatic = auto_result.get("automatic", False)

    endpoint_pin = resolve_device_endpoint_pin(
        device.pin,
        device.name,
        device.type,
        device.room
    )

    try:
        result = await send_command(endpoint_pin, body.action)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=504,
            detail=(
                "ESP32 did not respond at "
                f"/device/{endpoint_pin}/{body.action}"
            )
        ) from exc

    status = (
        True if body.action == "on"
        else False
    )

    device.status = status

    if isinstance(result, dict):
        sync_light_statuses(db, result)
        if "automaticIndoor" in result:
            automatic = result.get("automaticIndoor")
        elif manually_controls_light:
            automatic = result.get("automatic", automatic)

        if "automaticYard" in result:
            automatic_yard = result.get("automaticYard")
        elif manually_controls_yard_light:
            automatic_yard = result.get("automatic", automatic_yard)

    await run_in_threadpool(db.commit)

    return {
        "message": "success",
        "status": status,
        "automatic": automatic,
        "automaticYard": automatic_yard
    }


@router.post("/automatic-light/mode")
async def control_automatic_light(
    body: ControlRequest,
    db: Session = Depends(get_db)
):

    if body.action not in ("on", "off"):
        raise HTTPException(
            status_code=400,
            detail="Action must be 'on' or 'off'"
        )

    try:
        result = await set_automatic_light(body.action)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=504,
            detail="ESP32 did not respond"
        ) from exc

    sync_light_statuses(db, result)
    sync_inferred_automatic_light_statuses(db, result)
    await run_in_threadpool(db.commit)

    return {
        "message": "success",
        "automatic": bool(result.get("automatic")),
        "automaticYard": result.get("automaticYard"),
        "yardLight": result.get("yardLight")
    }


@router.get("/automatic-light/status")
async def read_automatic_light_status():

    try:
        result = await get_automatic_light_status()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=504,
            detail="ESP32 did not respond"
        ) from exc

    return {
        "automatic": bool(result.get("automatic")),
        "light1": result.get("light1"),
        "light2": result.get("light2"),
        "light3": result.get("light3"),
        "light4": result.get("light4")
    }


@router.post("/automatic-yard-light/mode")
async def control_automatic_yard_light(
    body: ControlRequest,
    db: Session = Depends(get_db)
):

    if body.action not in ("on", "off"):
        raise HTTPException(
            status_code=400,
            detail="Action must be 'on' or 'off'"
        )

    try:
        result = await set_automatic_yard_light(body.action)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=504,
            detail="ESP32 did not respond"
        ) from exc

    sync_light_statuses(db, result)
    await run_in_threadpool(db.commit)

    return {
        "message": "success",
        "automatic": bool(result.get("automatic")),
        "automaticIndoor": result.get("automaticIndoor"),
        "motionDetected": result.get("motionDetected"),
        "dark": result.get("dark"),
        "yardLight": result.get("yardLight")
    }


@router.get("/automatic-yard-light/status")
async def read_automatic_yard_light_status():

    try:
        result = await get_automatic_yard_light_status()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=504,
            detail="ESP32 did not respond"
        ) from exc

    return {
        "automatic": bool(result.get("automatic")),
        "motionDetected": result.get("motionDetected"),
        "dark": result.get("dark"),
        "yardLight": result.get("yardLight")
    }


@router.post("/automatic-clothes/mode")
async def control_automatic_clothes(
    body: ControlRequest,
    db: Session = Depends(get_db)
):

    if body.action not in ("on", "off"):
        raise HTTPException(
            status_code=400,
            detail="Action must be 'on' or 'off'"
        )

    try:
        result = await set_automatic_clothes(body.action)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=504,
            detail="ESP32 did not respond"
        ) from exc

    if result.get("clothesline") is not None:
        clothesline_status = bool(result.get("clothesline"))

        (
            db.query(Device)
            .filter(
                Device.pin == 14,
                Device.status != clothesline_status
            )
            .update(
                {Device.status: clothesline_status},
                synchronize_session=False
            )
        )
        await run_in_threadpool(db.commit)

    return {
        "message": "success",
        "automatic": bool(result.get("automatic")),
        "raining": result.get("raining"),
        "clothesline": result.get("clothesline")
    }


@router.get("/automatic-clothes/status")
async def read_automatic_clothes_status():

    try:
        result = await get_automatic_clothes_status()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=504,
            detail="ESP32 did not respond"
        ) from exc

    return {
        "automatic": bool(result.get("automatic")),
        "raining": result.get("raining"),
        "clothesline": result.get("clothesline")
    }
