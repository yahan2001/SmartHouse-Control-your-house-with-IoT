from pydantic import BaseModel

class DeviceResponse(BaseModel):

    id: int
    name: str
    type: str
    room: str
    status: bool
    pin: int

    class Config:
        from_attributes = True


class ControlRequest(BaseModel):

    action: str