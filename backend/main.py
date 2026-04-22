from fastapi import FastAPI
import requests

app = FastAPI()

ESP32_IP = "http://10.10.59.19"  # thay IP ESP32

@app.get("/on")
def turn_on():
    requests.get(f"{ESP32_IP}/on")
    return {"status": "on"}

@app.get("/off")
def turn_off():
    requests.get(f"{ESP32_IP}/off")
    return {"status": "off"}