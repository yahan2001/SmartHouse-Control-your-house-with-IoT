from pydantic import BaseModel


class VoiceCommandRequest(BaseModel):

    command: str


class VoiceCommandResponse(BaseModel):

    message: str
    command: str
    device_id: int | None = None
    device_name: str | None = None
    action: str | None = None
    status: bool | None = None
