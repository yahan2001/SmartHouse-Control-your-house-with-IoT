from pydantic import BaseModel


class PushTokenRequest(BaseModel):

    token: str
    platform: str | None = None


class PushTokenResponse(BaseModel):

    message: str
