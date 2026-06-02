import time

import httpx
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.models.notification_token import NotificationToken

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
GAS_ALERT_COOLDOWN_SECONDS = 60

_last_gas_alert_at = 0.0


async def send_push_notifications(
    tokens: list[str],
    title: str,
    body: str,
    data: dict | None = None
) -> None:
    if not tokens:
        return

    messages = [
        {
            "to": token,
            "sound": "default",
            "title": title,
            "body": body,
            "priority": "high",
            "data": data or {}
        }
        for token in tokens
    ]

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            EXPO_PUSH_URL,
            json=messages
        )

    response.raise_for_status()


async def send_gas_alert_if_needed(
    db: Session,
    gas_value: int,
    max_gas_value: int
) -> bool:
    global _last_gas_alert_at

    if gas_value <= max_gas_value:
        return False

    now = time.time()

    if now - _last_gas_alert_at < GAS_ALERT_COOLDOWN_SECONDS:
        return False

    tokens = await run_in_threadpool(
        lambda: [
            item.token
            for item in db.query(NotificationToken)
            .filter(NotificationToken.is_active == True)
            .all()
        ]
    )

    await send_push_notifications(
        tokens,
        "Canh bao khi gas",
        f"Gia tri gas dang nguy hiem: {gas_value}. Hay kiem tra ngay.",
        {
            "type": "gas_alert",
            "gas": gas_value,
            "threshold": max_gas_value
        }
    )

    _last_gas_alert_at = now
    return True
