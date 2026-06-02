from sqlalchemy import Column
from sqlalchemy import Integer
from sqlalchemy import String
from sqlalchemy import Boolean

from app.database import Base

class Device(Base):

    __tablename__ = "devices"

    id = Column(Integer, primary_key=True)

    name = Column(String(100))

    type = Column(String(50))

    room = Column(String(100))

    status = Column(Boolean)

    pin = Column(Integer)