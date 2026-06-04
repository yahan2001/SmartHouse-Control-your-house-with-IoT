from pydantic import BaseModel

class GasRequest(BaseModel):

    gas: int
    light: int = 0
    rain: int = 0
    raining: bool = False
    temperature: float
    humidity: float
    light1: bool | None = None
    light2: bool | None = None
    light3: bool | None = None
    light4: bool | None = None
    clothesline: bool | None = None
