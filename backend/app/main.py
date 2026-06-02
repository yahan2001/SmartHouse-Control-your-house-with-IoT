
from fastapi import FastAPI

from app.database import engine

from app.models.device import Device
from app.models.notification_token import NotificationToken
from app.models.sensor import SensorData

from app.routers.device_router import router 
from app.routers.sensor_router import router as sensor_router
from app.routers.assistant_router import router as assistant_router
from app.routers.notification_router import router as notification_router

app = FastAPI()

Device.metadata.create_all(bind=engine)
SensorData.metadata.create_all(bind=engine)
NotificationToken.metadata.create_all(bind=engine)

app.include_router(router)
app.include_router(sensor_router)
app.include_router(assistant_router)
app.include_router(notification_router)
