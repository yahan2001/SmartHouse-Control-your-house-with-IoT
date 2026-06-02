#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>
#include <HTTPClient.h>
#include <DHT.h>

/*
    WIFI
*/

const char* ssid = "THUC 24H COFFEE T2";
const char* password = "61ngothinham";



/*
    WEB SERVER
*/

WebServer server(80);

/*
    SERVO
*/

Servo doorServo;

/*
    GPIO ESP32 DevKit/WROOM
    Avoid GPIO 6-11 because they are used by onboard flash.
*/
int maxGasValue = 2500;
const unsigned long SENSOR_INTERVAL_MS = 5000;
const unsigned long SERVO_MOVE_MS = 700;
unsigned long lastSensorReadMs = 0;
#define LIGHT1 25
#define LIGHT2 26
#define LIGHT3 27
#define LIGHT4 32
#define SERVO_PIN 21
#define MQ2_PIN 34
#define BUZZER_PIN 23

#define DHTPIN 22
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

bool light1State = false;
bool light2State = false;
bool light3State = false;
bool light4State = false;

void moveDoorServo(int angle) {

    doorServo.attach(SERVO_PIN);
    doorServo.write(angle);
    delay(SERVO_MOVE_MS);
    doorServo.detach();
}

/*
    SEND GAS DATA TO FASTAPI
*/

void sendEnvironmentData(
    int gasValue,
    float temperature,
    float humidity
) {

    HTTPClient http;

    String serverUrl =
        "http://192.168.1.168:8000/sensor-data/";// Thay đổi URL của của backend

    http.begin(serverUrl);
    http.setTimeout(1000);

    http.addHeader(
        "Content-Type",
        "application/json"
    );

    String jsonData = "{";

    jsonData += "\"gas\":";
    jsonData += String(gasValue);
    jsonData += ",";

    jsonData += "\"temperature\":";
    jsonData += String(temperature);
    jsonData += ",";

    jsonData += "\"humidity\":";
    jsonData += String(humidity);

    jsonData += "}";

    int httpResponseCode =
        http.POST(jsonData);

    Serial.print("HTTP Response: ");
    Serial.println(httpResponseCode);

    String response =
        http.getString();

    Serial.println(response);

    http.end();
}

void setLight(
    int pin,
    bool& state,
    bool nextState,
    const char* deviceName
) {

    state = nextState;
    digitalWrite(pin, nextState ? HIGH : LOW);

    Serial.print(deviceName);
    Serial.println(nextState ? " ON" : " OFF");

    server.send(
        200,
        "text/plain",
        String(deviceName) + (nextState ? " ON" : " OFF")
    );
}

void openDoor() {

    moveDoorServo(90);

    Serial.println("Door Open");

    server.send(
        200,
        "text/plain",
        "Door Open"
    );
}

void closeDoor() {

    moveDoorServo(0);

    Serial.println("Door Close");

    server.send(
        200,
        "text/plain",
        "Door Close"
    );
}

void registerDeviceRoutes() {

    server.on("/device/25/on", []() { setLight(LIGHT1, light1State, true, "LIGHT1"); });
    server.on("/device/25/off", []() { setLight(LIGHT1, light1State, false, "LIGHT1"); });
    server.on("/device/2/on", []() { setLight(LIGHT1, light1State, true, "LIGHT1"); });
    server.on("/device/2/off", []() { setLight(LIGHT1, light1State, false, "LIGHT1"); });

    server.on("/device/26/on", []() { setLight(LIGHT2, light2State, true, "LIGHT2"); });
    server.on("/device/26/off", []() { setLight(LIGHT2, light2State, false, "LIGHT2"); });
    server.on("/device/6/on", []() { setLight(LIGHT2, light2State, true, "LIGHT2"); });
    server.on("/device/6/off", []() { setLight(LIGHT2, light2State, false, "LIGHT2"); });

    server.on("/device/27/on", []() { setLight(LIGHT3, light3State, true, "LIGHT3"); });
    server.on("/device/27/off", []() { setLight(LIGHT3, light3State, false, "LIGHT3"); });
    server.on("/device/7/on", []() { setLight(LIGHT3, light3State, true, "LIGHT3"); });
    server.on("/device/7/off", []() { setLight(LIGHT3, light3State, false, "LIGHT3"); });

    server.on("/device/32/on", []() { setLight(LIGHT4, light4State, true, "LIGHT4"); });
    server.on("/device/32/off", []() { setLight(LIGHT4, light4State, false, "LIGHT4"); });
    server.on("/device/10/on", []() { setLight(LIGHT4, light4State, true, "LIGHT4"); });
    server.on("/device/10/off", []() { setLight(LIGHT4, light4State, false, "LIGHT4"); });

    server.on("/device/21/on", openDoor);
    server.on("/device/21/off", closeDoor);
    server.on("/device/5/on", openDoor);
    server.on("/device/5/off", closeDoor);
}

void setup() {

    Serial.begin(115200);

    /*
        LIGHT SETUP
    */

    pinMode(LIGHT1, OUTPUT);
    pinMode(LIGHT2, OUTPUT);
    pinMode(LIGHT3, OUTPUT);
    pinMode(LIGHT4, OUTPUT);

    digitalWrite(LIGHT1, LOW);
    digitalWrite(LIGHT2, LOW);
    digitalWrite(LIGHT3, LOW);
    digitalWrite(LIGHT4, LOW);

    /*
        BUZZER
    */

    pinMode(BUZZER_PIN, OUTPUT);

    digitalWrite(BUZZER_PIN, LOW);

    /*
        DHT SENSOR
    */
    dht.begin();
    delay(2000);

    /*
        WIFI CONNECT
    */

    WiFi.mode(WIFI_STA);
    WiFi.setTxPower(WIFI_POWER_8_5dBm);
    WiFi.begin(ssid, password);

    while (WiFi.status() != WL_CONNECTED) {

        delay(500);
        Serial.print(".");
    }

    Serial.println();
    Serial.println("WiFi Connected");

    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());

    /*
        DEVICE ROUTES
        Old C3 pin routes are kept so existing backend device records still work.
    */

    registerDeviceRoutes();

    /*
        START SERVER
    */

    server.begin();

    Serial.println("Server Started");
}

void loop() {

    /*
        HANDLE HTTP REQUEST
    */

    server.handleClient();

    unsigned long now = millis();

    if(now - lastSensorReadMs < SENSOR_INTERVAL_MS) {

        return;
    }

    lastSensorReadMs = now;

    /*
        READ GAS SENSOR
    */

    int gasValue =
        analogRead(MQ2_PIN);

    float temperature =
        dht.readTemperature();

    float humidity =
        dht.readHumidity();
    // ép xạ giá trị đọc được từ cảm biến DHT11 về 0 nếu có lỗi đọc dữ liệu (trả về NaN)
    if(isnan(temperature)) {

    Serial.println(
        "Temperature sensor error"
    );

    temperature = 0;
    }  
    
    if(isnan(humidity)) {

    Serial.println(
        "Humidity sensor error"
    );

    humidity = 0;
    }

    Serial.print("Gas: ");
    Serial.println(gasValue);

    Serial.print("Temperature: ");
    Serial.println(temperature);

    Serial.print("Humidity: ");
    Serial.println(humidity);

    /*
        GAS ALERT
    */

    if(gasValue > maxGasValue) {

        digitalWrite(
            BUZZER_PIN,
            HIGH
        );

        Serial.println(
            "WARNING: GAS DETECTED"
        );

    } else {

        digitalWrite(
            BUZZER_PIN,
            LOW
        );
    }



    /*
        SEND DATA TO FASTAPI
    */

    if(WiFi.status() == WL_CONNECTED) {

        sendEnvironmentData(gasValue, temperature, humidity);
    }

}
