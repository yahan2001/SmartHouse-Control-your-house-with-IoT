from sqlalchemy import Column, Float
from sqlalchemy import Integer

from app.database import Base

class SensorData(Base):

    __tablename__ = "sensor_data"

    id = Column(
        Integer,
        primary_key=True
    )

    gas = Column(Integer)
    temperature = Column(Float)
    humidity = Column(Float)