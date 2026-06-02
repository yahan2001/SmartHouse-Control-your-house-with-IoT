from fastapi import APIRouter, Depends, HTTPException

import httpx
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.database import get_db

from app.models.device import Device

from app.schemas.device_schema import (
    DeviceResponse,
    ControlRequest
)

from app.services.esp_service import send_command

router = APIRouter(
    prefix="/devices",
    tags=["Devices"]
)
@router.get("/", response_model=list[DeviceResponse])
async def get_devices(db: Session = Depends(get_db)):

    devices = await run_in_threadpool(lambda: db.query(Device).all())

    return devices
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

    try:
        await send_command(device.pin, body.action)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=504,
            detail="ESP32 did not respond"
        ) from exc

    status = (
        True if body.action == "on"
        else False
    )
    device.status = status

    await run_in_threadpool(db.commit)

    return {
        "message": "success",
        "status": status
    }
