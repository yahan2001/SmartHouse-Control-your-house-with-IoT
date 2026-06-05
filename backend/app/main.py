
from fastapi import FastAPI
from sqlalchemy import inspect, text

from app.database import engine

from app.models.device import Device
from app.models.notification_token import NotificationToken
from app.models.sensor import SensorData

from app.routers.device_router import router 
from app.routers.sensor_router import router as sensor_router
from app.routers.assistant_router import router as assistant_router
from app.routers.notification_router import router as notification_router
from app.routers.door_router import router as door_router

app = FastAPI()

Device.metadata.create_all(bind=engine)
SensorData.metadata.create_all(bind=engine)
NotificationToken.metadata.create_all(bind=engine)

with engine.begin() as connection:
    columns = {
        column["name"]
        for column in inspect(connection).get_columns("sensor_data")
    }

    if "light" not in columns:
        connection.execute(
            text("ALTER TABLE sensor_data ADD COLUMN light INT DEFAULT 0")
        )

    if "rain" not in columns:
        connection.execute(
            text("ALTER TABLE sensor_data ADD COLUMN rain INT DEFAULT 0")
        )

    if "raining" not in columns:
        connection.execute(
            text("ALTER TABLE sensor_data ADD COLUMN raining BOOLEAN DEFAULT FALSE")
        )

    if "pir" not in columns:
        connection.execute(
            text("ALTER TABLE sensor_data ADD COLUMN pir INT DEFAULT 0")
        )

    if "motionDetected" not in columns:
        connection.execute(
            text(
                "ALTER TABLE sensor_data "
                "ADD COLUMN motionDetected BOOLEAN DEFAULT FALSE"
            )
        )

app.include_router(router)
app.include_router(sensor_router)
app.include_router(assistant_router)
app.include_router(notification_router)
app.include_router(door_router)
