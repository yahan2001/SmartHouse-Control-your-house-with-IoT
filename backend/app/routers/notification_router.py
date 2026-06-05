from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.database import get_db
from app.models.notification_token import NotificationToken
from app.schemas.notification_schema import (
    PushTokenRequest,
    PushTokenResponse
)
from app.services.notification_service import send_push_notifications

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


@router.post("/test")
async def send_test_notification(
    db: Session = Depends(get_db)
):

    tokens = await run_in_threadpool(
        lambda: [
            item.token
            for item in db.query(NotificationToken)
            .filter(NotificationToken.is_active == True)
            .all()
        ]
    )

    if not tokens:
        raise HTTPException(
            status_code=404,
            detail="No active push notification tokens"
        )

    try:
        result = await send_push_notifications(
            tokens,
            "Lumina Home",
            "Thông báo thử nghiệm từ backend.",
            {"type": "test_notification"}
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Expo push failed: {exc}"
        ) from exc

    return {
        "message": "sent",
        "tokens": len(tokens),
        "expo": result
    }
