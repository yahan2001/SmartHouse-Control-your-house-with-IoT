# Cach chay Smart Home App

He thong hien tai khong dung keypad de mo cua. Cua duoc dieu khien tu app thong qua backend FastAPI, backend gui lenh den ESP32 qua cac endpoint HTTP cua firmware.

## 1. Chay firmware ESP32

1. Mo project nay bang PlatformIO.
2. Kiem tra cong upload trong `platformio.ini`:

```ini
upload_port = COM8
monitor_port = COM8
```

3. Cap nhat Wi-Fi va IP backend trong `src/main.cpp` neu can:

```cpp
const char* ssid = "...";
const char* password = "...";
String serverUrl = "http://<BACKEND_IP>:8000/sensor-data/";
```

4. Upload firmware len ESP32.
5. Mo Serial Monitor baud `115200` va ghi lai IP cua ESP32.

## 2. Chay backend FastAPI

```powershell
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Mo file `backend/.env` va sua cac gia tri:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=smart_home
ESP32_IP=http://<ESP32_IP>
ESP32_CAM_IP=http://<ESP32_CAM_IP>:81
GEMINI_API_KEY=input_your_gemini_api_key_here
```

Chay backend:

```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Backend se chay tai:

```text
http://<MAY_TINH_IP>:8000
```

## 3. Chay app mobile Expo

```powershell
cd myApp
npm install
npm run start
```

Mo app bang Expo Go tren dien thoai. Dien thoai va may tinh chay backend nen o cung mot mang Wi-Fi.

Trong app, vao phan cau hinh server va nhap:

```text
<MAY_TINH_IP>:8000
```

Vi du:

```text
192.168.1.100:8000
```

## 4. Mo cua bang app

1. Dam bao backend dang chay.
2. Dam bao ESP32 da ket noi Wi-Fi va backend biet dung `ESP32_IP`.
3. Trong app, chon thiet bi cua/cua vao.
4. Bam bat/mo de goi backend.
5. Backend se gui lenh den ESP32:

```text
GET http://<ESP32_IP>/device/21/on
```

Lenh dong cua:

```text
GET http://<ESP32_IP>/device/21/off
```

## Loi thuong gap

- App khong ket noi backend: kiem tra IP may tinh va firewall Windows cho port `8000`.
- Backend bao ESP32 khong phan hoi: kiem tra `ESP32_IP` trong `backend/.env`.
- ESP32 khong upload duoc: kiem tra dung cong COM trong `platformio.ini`.
- Dien thoai khong thay backend: dam bao dien thoai va may tinh cung mang Wi-Fi.
