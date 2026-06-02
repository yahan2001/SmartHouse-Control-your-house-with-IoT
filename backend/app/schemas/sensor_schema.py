from pydantic import BaseModel

class GasRequest(BaseModel):

    gas: int
    temperature: float
    humidity: float