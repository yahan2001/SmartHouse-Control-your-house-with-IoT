from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import httpx

from app.services.door_service import get_door_status, set_door_password


router = APIRouter(
    prefix="/door",
    tags=["Door"]
)


class DoorPasswordRequest(BaseModel):
    password: str = Field(min_length=4, max_length=12)


@router.post("/password")
async def update_door_password(body: DoorPasswordRequest):
    if not body.password.isdigit():
        raise HTTPException(
            status_code=400,
            detail="Password must contain digits only"
        )

    try:
        result = await set_door_password(body.password)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.text
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=504,
            detail="ESP32 door did not respond"
        ) from exc

    return {
        "message": "Door password updated",
        "door": result
    }


@router.get("/status")
async def read_door_status():
    try:
        return await get_door_status()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=504,
            detail="ESP32 door did not respond"
        ) from exc
