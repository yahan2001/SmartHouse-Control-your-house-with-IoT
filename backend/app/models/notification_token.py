from sqlalchemy import Boolean, Column, DateTime, Integer, String
from sqlalchemy.sql import func

from app.database import Base


class NotificationToken(Base):

    __tablename__ = "notification_tokens"

    id = Column(Integer, primary_key=True)
    token = Column(String(255), unique=True, nullable=False)
    platform = Column(String(50), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )
