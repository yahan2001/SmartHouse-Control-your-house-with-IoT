# SmartHouse Control Your House With IoT

Project điều khiển nhà thông minh bằng ESP32, FastAPI backend và ứng dụng mobile Expo/React Native.

Hệ thống hiện tại không dùng keypad để mở cửa. Cửa được mở/đóng từ app mobile, app gọi backend FastAPI, backend gửi lệnh HTTP đến ESP32.

## Thành phần chính

- `src/main.cpp`: firmware ESP32 chính cho đèn, cảm biến gas, cảm biến mưa, PIR, DHT11, servo cửa và giàn phơi.
- `backend/`: FastAPI backend, lưu dữ liệu cảm biến, điều khiển thiết bị, push notification và trợ lý giọng nói Gemini.
- `myApp/`: app mobile Expo/React Native để xem cảm biến, điều khiển thiết bị, camera và tự động hóa.
- `esp/`: các sketch ESP thử nghiệm hoặc phần ESP32-CAM/AWS IoT riêng.

## Luồng mở cửa qua app

1. Người dùng bấm mở cửa trong app.
2. App gọi backend:

```text
POST http://<BACKEND_IP>:8000/devices/<door_device_id>
```

3. Backend resolve thiết bị cửa sang pin endpoint `21`.
4. Backend gửi lệnh đến ESP32:

```text
GET http://<ESP32_IP>/device/21/on
```

5. ESP32 quay servo mở cửa.

Lệnh đóng cửa:

```text
GET http://<ESP32_IP>/device/21/off
```

## 1. Chạy firmware ESP32

Mở project bằng PlatformIO.

Kiểm tra cổng upload trong `platformio.ini`:

```ini
upload_port = COM8
monitor_port = COM8
monitor_speed = 115200
```

Cập nhật Wi-Fi và IP backend trong `src/main.cpp` nếu cần:

```cpp
const char* ssid = "...";
const char* password = "...";
String serverUrl = "http://<BACKEND_IP>:8000/sensor-data/";
```

Upload firmware lên ESP32, sau đó mở Serial Monitor baud `115200` để xem IP của ESP32.

## 2. Chạy backend FastAPI

```powershell
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Mở `backend/.env` và sửa theo máy của bạn:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=smart_home
ESP32_IP=http://<ESP32_IP>
ESP32_CAM_IP=http://<ESP32_CAM_IP>:81
GEMINI_API_KEY=input_your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
```

Chạy backend:

```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Backend sẽ chạy tại:

```text
http://<MAY_TINH_IP>:8000
```

## 3. Chạy app mobile

```powershell
cd myApp
npm install
npm run start
```

Mở app bằng Expo Go trên điện thoại.

Điện thoại, máy chạy backend và ESP32 nên ở cùng một mạng Wi-Fi.

Trong app, mở phần cấu hình server và nhập:

```text
<MAY_TINH_IP>:8000
```

Ví dụ:

```text
192.168.1.100:8000
```

## 4. Các endpoint quan trọng

Backend:

```text
GET  /devices/
POST /devices/{device_id}
GET  /sensor-data/latest
POST /sensor-data/
POST /assistant/voice-command
POST /assistant/voice-audio
```

ESP32:

```text
GET /device/21/on
GET /device/21/off
GET /device/25/on
GET /device/25/off
GET /automatic-light/on
GET /automatic-light/off
GET /automatic-clothes/on
GET /automatic-clothes/off
GET /automatic-yard-light/on
GET /automatic-yard-light/off
```

## 5. Thư viện backend

Backend chỉ cần các package trong `backend/requirements.txt`:

```txt
fastapi
uvicorn
sqlalchemy
pymysql
httpx
python-multipart
python-dotenv
```

Không commit `backend/venv/`, `node_modules/`, `.pio/`, `.expo/` hoặc `__pycache__/`.

## Lỗi thường gặp

- App không kết nối backend: kiểm tra IP máy tính và firewall Windows cho port `8000`.
- Backend báo ESP32 không phản hồi: kiểm tra `ESP32_IP` trong `backend/.env`.
- ESP32 không upload được: kiểm tra đúng cổng COM trong `platformio.ini`.
- Điện thoại không thấy backend: kiểm tra điện thoại và máy tính có cùng Wi-Fi không.
- Gemini không chạy: kiểm tra `GEMINI_API_KEY` trong `backend/.env`.
