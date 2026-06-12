# SmartHouse Control Your House With IoT

Project dieu khien nha thong minh bang mot ESP32, FastAPI backend va ung dung mobile Expo/React Native.

He thong hien tai:

- Khong dung keypad de mo cua.
- Chi dung mot ESP32 chay firmware trong `src/main.cpp`.
- Cua duoc mo/dong tu app mobile. App goi backend FastAPI, backend gui lenh HTTP den ESP32.

## Thanh phan chinh

- `src/main.cpp`: firmware ESP32 chinh cho den, cam bien gas, cam bien mua, PIR, DHT11, servo cua va gian phoi.
- `backend/`: FastAPI backend, luu du lieu cam bien, dieu khien thiet bi, push notification va tro ly giong noi Gemini.
- `myApp/`: app mobile Expo/React Native de xem cam bien, dieu khien thiet bi va che do tu dong.
- `platformio.ini`: cau hinh PlatformIO cho ESP32.

## Luong mo cua qua app

1. Nguoi dung bam mo cua trong app.
2. App goi backend:

```text
POST http://<BACKEND_IP>:8000/devices/<door_device_id>
```

3. Backend resolve thiet bi cua sang endpoint pin `21`.
4. Backend gui lenh den ESP32:

```text
GET http://<ESP32_IP>/device/21/on
```

5. ESP32 quay servo mo cua.

Lenh dong cua:

```text
GET http://<ESP32_IP>/device/21/off
```

## 1. Chay firmware ESP32

Mo project bang PlatformIO.

Kiem tra cong upload trong `platformio.ini`:

```ini
upload_port = COM8
monitor_port = COM8
monitor_speed = 115200
```

Cap nhat Wi-Fi va IP backend trong `src/main.cpp` neu can:

```cpp
const char* ssid = "...";
const char* password = "...";
String serverUrl = "http://<BACKEND_IP>:8000/sensor-data/";
```

Upload firmware len ESP32, sau do mo Serial Monitor baud `115200` de xem IP cua ESP32.

## 2. Chay backend FastAPI

```powershell
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Mo `backend/.env` va sua theo may cua ban:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=smart_home
ESP32_IP=http://<ESP32_IP>
GEMINI_API_KEY=input_your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
```

Chay backend:

```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Backend se chay tai:

```text
http://<MAY_TINH_IP>:8000
```

## 3. Chay app mobile

```powershell
cd myApp
npm install
npm run start
```

Mo app bang Expo Go tren dien thoai.

Dien thoai, may chay backend va ESP32 nen o cung mot mang Wi-Fi.

Trong app, mo phan cau hinh server va nhap:

```text
<MAY_TINH_IP>:8000
```

Vi du:

```text
192.168.1.100:8000
```

## Endpoint quan trong

Backend:

```text
GET  /devices/
POST /devices/{device_id}
GET  /sensor-data/latest
POST /sensor-data/
POST /assistant/voice-command
POST /assistant/voice-audio
POST /notifications/register
```

ESP32:

```text
GET /device/21/on
GET /device/21/off
GET /device/25/on
GET /device/25/off
GET /device/26/on
GET /device/26/off
GET /device/27/on
GET /device/27/off
GET /device/32/on
GET /device/32/off
GET /device/33/on
GET /device/33/off
GET /automatic-light/on
GET /automatic-light/off
GET /automatic-clothes/on
GET /automatic-clothes/off
GET /automatic-yard-light/on
GET /automatic-yard-light/off
```

## Thu vien backend

Backend chi can cac package trong `backend/requirements.txt`:

```txt
fastapi
uvicorn
sqlalchemy
pymysql
httpx
python-multipart
python-dotenv
```

Khong commit `backend/venv/`, `node_modules/`, `.pio/`, `.expo/` hoac `__pycache__/`.

## Loi thuong gap

- App khong ket noi backend: kiem tra IP may tinh va firewall Windows cho port `8000`.
- Backend bao ESP32 khong phan hoi: kiem tra `ESP32_IP` trong `backend/.env`.
- ESP32 khong upload duoc: kiem tra dung cong COM trong `platformio.ini`.
- Dien thoai khong thay backend: kiem tra dien thoai va may tinh co cung Wi-Fi khong.
- Gemini khong chay: kiem tra `GEMINI_API_KEY` trong `backend/.env`.
