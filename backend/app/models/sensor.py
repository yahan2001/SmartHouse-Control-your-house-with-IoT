from sqlalchemy import Boolean, Column, Float
from sqlalchemy import Integer

from app.database import Base

class SensorData(Base):

    __tablename__ = "sensor_data"

    id = Column(
        Integer,
        primary_key=True
    )

    gas = Column(Integer)
    light = Column(Integer, default=0)
    rain = Column(Integer, default=0)
    raining = Column(Boolean, default=False)
    temperature = Column(Float)
    humidity = Column(Float)
