from fastapi import APIRouter, BackgroundTasks, Request
from fastapi import Depends
import httpx
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from app.database import SessionLocal, get_db
from app.models.device import Device
from app.models.sensor import SensorData
from app.schemas.sensor_schema import GasRequest
from app.services.esp_service import set_esp32_ip_from_host
from app.services.notification_service import send_gas_alert_if_needed

MAX_GAS_VALUE = 1500
LIGHT_STATUS_PINS = {
    "light1": (25, 2),
    "light2": (26, 6),
    "light3": (27, 7),
    "light4": (32, 10),
    "clothesline": (12,),
}

router = APIRouter(
    prefix="/sensor-data",
    tags=["Sensor"]
)


async def send_gas_alert_background(gas_value: int):
    db = SessionLocal()

    try:
        await send_gas_alert_if_needed(
            db,
            gas_value,
            MAX_GAS_VALUE
        )
    except httpx.HTTPError as exc:
        print("Push notification failed:", exc)
    finally:
        db.close()


async def sync_light_status_background(status_payload: dict):
    db = SessionLocal()

    try:
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

        await run_in_threadpool(db.commit)
    except OperationalError as exc:
        await run_in_threadpool(db.rollback)
        print("Device status sync skipped:", exc)
    finally:
        db.close()

@router.post("/")

async def save_sensor_data(
    data: GasRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    set_esp32_ip_from_host(request.client.host if request.client else None)

    sensor = SensorData(
        gas=data.gas,
        light=data.light,
        rain=data.rain,
        raining=data.raining,
        temperature=data.temperature,
        humidity=data.humidity
    )

    db.add(sensor)

    await run_in_threadpool(db.commit)

    background_tasks.add_task(send_gas_alert_background, data.gas)
    background_tasks.add_task(
        sync_light_status_background,
        {
            field_name: getattr(data, field_name)
            for field_name in LIGHT_STATUS_PINS
        }
    )

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
