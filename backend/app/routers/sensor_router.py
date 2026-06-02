from fastapi import APIRouter
from fastapi import Depends
import httpx
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from app.database import get_db
from app.models.sensor import SensorData
from app.schemas.sensor_schema import GasRequest
from app.services.notification_service import send_gas_alert_if_needed

MAX_GAS_VALUE = 2500

router = APIRouter(
    prefix="/sensor-data",
    tags=["Sensor"]
)

@router.post("/")

async def save_sensor_data(
    data: GasRequest,
    db: Session = Depends(get_db)
):

    sensor = SensorData(
        gas=data.gas,
        temperature=data.temperature,
        humidity=data.humidity
    )

    db.add(sensor)

    await run_in_threadpool(db.commit)

    try:
        await send_gas_alert_if_needed(
            db,
            data.gas,
            MAX_GAS_VALUE
        )
    except httpx.HTTPError as exc:
        print("Push notification failed:", exc)

    return {
        "message": "saved"
    }

@router.get("/latest")

async def get_latest_gas(
    db: Session = Depends(get_db)
):

    latest = await run_in_threadpool(
        lambda: (
            db.query(SensorData)
            .order_by(
                SensorData.id.desc()
            )
            .first()
        )
    )

    return latest
