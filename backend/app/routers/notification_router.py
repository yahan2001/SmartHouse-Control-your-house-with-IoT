from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.database import get_db
from app.models.notification_token import NotificationToken
from app.schemas.notification_schema import (
    PushTokenRequest,
    PushTokenResponse
)

router = APIRouter(
    prefix="/notifications",
    tags=["Notifications"]
)


@router.post("/register", response_model=PushTokenResponse)
async def register_push_token(
    body: PushTokenRequest,
    db: Session = Depends(get_db)
):
    token = body.token.strip()

    if not token:
        raise HTTPException(
            status_code=400,
            detail="Token is required"
        )

    def upsert_token():
        existing = (
            db.query(NotificationToken)
            .filter(NotificationToken.token == token)
            .first()
        )

        if existing:
            existing.platform = body.platform
            existing.is_active = True
        else:
            db.add(
                NotificationToken(
                    token=token,
                    platform=body.platform,
                    is_active=True
                )
            )

        db.commit()

    await run_in_threadpool(upsert_token)

    return PushTokenResponse(
        message="registered"
    )
