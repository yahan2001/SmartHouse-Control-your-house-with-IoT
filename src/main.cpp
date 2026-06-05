#include <WiFi.h>
#include <math.h>
#include <WebServer.h>
#include <ESP32Servo.h>
#include <HTTPClient.h>
#include <DHT.h>

/*
    WIFI
*/

const char* ssid = "TRAM 247 STUDY CAFE & WORKSPACE";
const char* password = "tramloveyou";


/*
    WEB SERVER
*/

WebServer server(80);

/*
    SERVO
*/

Servo doorServo;
Servo clothesServo;

/*
    GPIO ESP32 DevKit/WROOM
    Avoid GPIO 6-11 because they are used by onboard flash.
*/
int maxGasValue = 1500;
int darkLightValue = 3000;
int brightLightValue = 2900;
int rainDetectedLevel = LOW;
const unsigned long SENSOR_INTERVAL_MS = 5000;
const unsigned long SENSOR_POST_CONNECT_TIMEOUT_MS = 1000;
const unsigned long SENSOR_POST_READ_TIMEOUT_MS = 1500;
const unsigned long SENSOR_POST_BACKOFF_MS = 15000;
const unsigned long SERVO_MOVE_MS = 1500;
const unsigned long BUTTON_DEBOUNCE_MS = 80;
const int SERVO_MIN_ANGLE = 0;
const int SERVO_MAX_ANGLE = 90;
unsigned long lastSensorReadMs = 0;
unsigned long sensorPostBackoffUntilMs = 0;
int failedSensorPostCount = 0;
const bool BUZZER_ACTIVE_LOW = false;
const int BUZZER_CHANNEL = 15;
const int BUZZER_RESOLUTION = 8;
const int BUZZER_ALARM_FREQ = 2500;
const unsigned long BUZZER_STEP_INTERVAL_MS = 10;
bool buzzerActive = false;
int buzzerSinStep = 0;
unsigned long lastBuzzerStepMs = 0;
#define LIGHT1 25
#define LIGHT2 26
#define LIGHT3 27
#define LIGHT4 32
#define YARD_LIGHT_PIN 33
#define BTN_LIGHT1 13
#define BTN_LIGHT2 16
#define BTN_LIGHT3 17
#define BTN_LIGHT4 4
#define SERVO_PIN 21
#define CLOTHES_SERVO_PIN 14
#define MQ2_PIN 34
#define LIGHT_SENSOR_PIN 35
#define RAIN_SENSOR_PIN 19
#define PIR_SENSOR_PIN 18
#define BUZZER_PIN 23

#define DHTPIN 22
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

bool light1State = false;
bool light2State = false;
bool light3State = false;
bool light4State = false;
bool lastBtnLight1State = HIGH;
bool lastBtnLight2State = HIGH;
bool lastBtnLight3State = HIGH;
bool lastBtnLight4State = HIGH;
bool automaticLightMode = false;
bool automaticLightsOn = false;
bool yardLightState = false;
bool automaticYardLightMode = true;
bool clotheslineExtended = true;
bool automaticClothesMode = true;
int clothesServoPos = -1;
bool doorServoAttached = false;
unsigned long doorServoDetachAtMs = 0;
unsigned long lastBtnLight1ChangeMs = 0;
unsigned long lastBtnLight2ChangeMs = 0;
unsigned long lastBtnLight3ChangeMs = 0;
unsigned long lastBtnLight4ChangeMs = 0;

String buildAutomaticStatusJson();
String buildAutomaticYardLightStatusJson(bool motionDetected, int lightValue);

void moveDoorServo(int angle) {

    if(!doorServoAttached) {
        doorServo.attach(SERVO_PIN);
        doorServoAttached = true;
    }

    doorServo.write(angle);
    doorServoDetachAtMs = millis() + SERVO_MOVE_MS;
    sensorPostBackoffUntilMs = doorServoDetachAtMs;
}

void updateDoorServo(unsigned long now) {

    if(!doorServoAttached) {
        return;
    }

    if(now < doorServoDetachAtMs) {
        return;
    }

    doorServo.detach();
    doorServoAttached = false;
}

void moveClothesServo(int angle) {

    if(clothesServoPos == angle) {
        return;
    }

    Serial.print("Clothes servo angle: ");
    Serial.println(angle);

    clothesServo.write(angle);
    clothesServoPos = angle;
    delay(SERVO_MOVE_MS);
}

/*
    SEND GAS DATA TO FASTAPI
*/

bool sendEnvironmentData(
    int gasValue,
    int lightValue,
    int rainValue,
    bool raining,
    bool motionDetected,
    float temperature,
    float humidity
) {

    HTTPClient http;

    String serverUrl ="http://172.16.0.206:8000/sensor-data/";//ip backend fastapi

    http.begin(serverUrl);
    http.setConnectTimeout(SENSOR_POST_CONNECT_TIMEOUT_MS);
    http.setTimeout(SENSOR_POST_READ_TIMEOUT_MS);
    http.setReuse(false);

    http.addHeader(
        "Content-Type",
        "application/json"
    );

    String jsonData = "{";

    jsonData += "\"gas\":";
    jsonData += String(gasValue);
    jsonData += ",";

    jsonData += "\"light\":";
    jsonData += String(lightValue);
    jsonData += ",";

    jsonData += "\"rain\":";
    jsonData += String(rainValue);
    jsonData += ",";

    jsonData += "\"raining\":";
    jsonData += raining ? "true" : "false";
    jsonData += ",";

    jsonData += "\"motionDetected\":";
    jsonData += motionDetected ? "true" : "false";
    jsonData += ",";

    jsonData += "\"pir\":";
    jsonData += motionDetected ? "1" : "0";
    jsonData += ",";

    jsonData += "\"temperature\":";
    jsonData += String(temperature);
    jsonData += ",";

    jsonData += "\"humidity\":";
    jsonData += String(humidity);
    jsonData += ",";

    jsonData += "\"light1\":";
    jsonData += light1State ? "true" : "false";
    jsonData += ",";

    jsonData += "\"light2\":";
    jsonData += light2State ? "true" : "false";
    jsonData += ",";

    jsonData += "\"light3\":";
    jsonData += light3State ? "true" : "false";
    jsonData += ",";

    jsonData += "\"light4\":";
    jsonData += light4State ? "true" : "false";
    jsonData += ",";

    jsonData += "\"clothesline\":";
    jsonData += clotheslineExtended ? "true" : "false";
    jsonData += ",";

    jsonData += "\"yardLight\":";
    jsonData += yardLightState ? "true" : "false";

    jsonData += "}";

    int httpResponseCode =
        http.POST(jsonData);

    Serial.print("HTTP Response: ");
    Serial.println(httpResponseCode);

    if(httpResponseCode < 0) {

        Serial.print("HTTP Error: ");
        Serial.println(http.errorToString(httpResponseCode));
        http.end();

        return false;
    }

    String response =
        http.getString();

    Serial.println(response);

    http.end();

    return true;
}

void applyLight(
    int pin,
    bool& state,
    bool nextState,
    const char* deviceName
) {

    state = nextState;
    digitalWrite(pin, nextState ? HIGH : LOW);

    Serial.print(deviceName);
    Serial.println(nextState ? " ON" : " OFF");
}

void setLight(
    int pin,
    bool& state,
    bool nextState,
    const char* deviceName
) {

    applyLight(pin, state, nextState, deviceName);

    server.send(
        200,
        "text/plain",
        String(deviceName) + (nextState ? " ON" : " OFF")
    );
}

void setManualLight(
    int pin,
    bool& state,
    bool nextState,
    const char* deviceName
) {

    automaticLightMode = false;
    applyLight(pin, state, nextState, deviceName);

    Serial.println("Automatic light mode OFF by manual control");

    server.send(
        200,
        "application/json",
        buildAutomaticStatusJson()
    );
}

void setAllLights(bool nextState) {

    applyLight(LIGHT1, light1State, nextState, "LIGHT1");
    applyLight(LIGHT2, light2State, nextState, "LIGHT2");
    applyLight(LIGHT3, light3State, nextState, "LIGHT3");
    applyLight(LIGHT4, light4State, nextState, "LIGHT4");
    automaticLightsOn = nextState;
}

void toggleManualLightFromButton(
    int lightPin,
    bool& lightState,
    const char* deviceName
) {

    automaticLightMode = false;
    applyLight(lightPin, lightState, !lightState, deviceName);
    automaticLightsOn =
        light1State &&
        light2State &&
        light3State &&
        light4State;

    Serial.println("Automatic light mode OFF by wall button");
}

void handleLightButton(
    int buttonPin,
    bool& lastButtonState,
    unsigned long& lastChangeMs,
    int lightPin,
    bool& lightState,
    const char* deviceName,
    unsigned long now
) {

    bool currentState = digitalRead(buttonPin);

    if(currentState == lastButtonState) {
        return;
    }

    if(now - lastChangeMs < BUTTON_DEBOUNCE_MS) {
        return;
    }

    lastChangeMs = now;

    if(lastButtonState == HIGH && currentState == LOW) {
        toggleManualLightFromButton(
            lightPin,
            lightState,
            deviceName
        );
    }

    lastButtonState = currentState;
}

void handleLightButtons(unsigned long now) {

    handleLightButton(
        BTN_LIGHT1,
        lastBtnLight1State,
        lastBtnLight1ChangeMs,
        LIGHT1,
        light1State,
        "LIGHT1",
        now
    );

    handleLightButton(
        BTN_LIGHT2,
        lastBtnLight2State,
        lastBtnLight2ChangeMs,
        LIGHT2,
        light2State,
        "LIGHT2",
        now
    );

    handleLightButton(
        BTN_LIGHT3,
        lastBtnLight3State,
        lastBtnLight3ChangeMs,
        LIGHT3,
        light3State,
        "LIGHT3",
        now
    );

    handleLightButton(
        BTN_LIGHT4,
        lastBtnLight4State,
        lastBtnLight4ChangeMs,
        LIGHT4,
        light4State,
        "LIGHT4",
        now
    );
}

void applyYardLight(bool nextState) {

    yardLightState = nextState;
    digitalWrite(YARD_LIGHT_PIN, nextState ? HIGH : LOW);

    Serial.print("YARD LIGHT");
    Serial.println(nextState ? " ON" : " OFF");
}

String buildAutomaticYardLightStatusJson(bool motionDetected, int lightValue) {

    String jsonData = "{";

    jsonData += "\"automatic\":";
    jsonData += automaticYardLightMode ? "true" : "false";
    jsonData += ",";

    jsonData += "\"motionDetected\":";
    jsonData += motionDetected ? "true" : "false";
    jsonData += ",";

    jsonData += "\"dark\":";
    jsonData += lightValue > darkLightValue ? "true" : "false";
    jsonData += ",";

    jsonData += "\"yardLight\":";
    jsonData += yardLightState ? "true" : "false";

    jsonData += "}";

    return jsonData;
}

void setManualYardLight(bool nextState) {

    automaticYardLightMode = false;
    applyYardLight(nextState);

    Serial.println("Automatic yard light mode OFF by manual control");

    server.send(
        200,
        "application/json",
        buildAutomaticYardLightStatusJson(
            digitalRead(PIR_SENSOR_PIN) == HIGH,
            analogRead(LIGHT_SENSOR_PIN)
        )
    );
}

String buildAutomaticStatusJson() {

    String jsonData = "{";

    jsonData += "\"automatic\":";
    jsonData += automaticLightMode ? "true" : "false";
    jsonData += ",";

    jsonData += "\"light1\":";
    jsonData += light1State ? "true" : "false";
    jsonData += ",";

    jsonData += "\"light2\":";
    jsonData += light2State ? "true" : "false";
    jsonData += ",";

    jsonData += "\"light3\":";
    jsonData += light3State ? "true" : "false";
    jsonData += ",";

    jsonData += "\"light4\":";
    jsonData += light4State ? "true" : "false";

    jsonData += "}";

    return jsonData;
}

void setAutomaticLightMode(bool enabled) {

    automaticLightMode = enabled;

    Serial.print("Automatic light mode ");
    Serial.println(enabled ? "ON" : "OFF");

    server.send(
        200,
        "application/json",
        buildAutomaticStatusJson()
    );
}

void setAutomaticYardLightMode(bool enabled) {

    automaticYardLightMode = enabled;

    Serial.print("Automatic yard light mode ");
    Serial.println(enabled ? "ON" : "OFF");

    server.send(
        200,
        "application/json",
        buildAutomaticYardLightStatusJson(
            digitalRead(PIR_SENSOR_PIN) == HIGH,
            analogRead(LIGHT_SENSOR_PIN)
        )
    );
}

void openDoor() {

    moveDoorServo(SERVO_MIN_ANGLE);

    Serial.println("Door Open");

    server.send(
        200,
        "text/plain",
        "Door Open"
    );
}

void closeDoor() {

    moveDoorServo(SERVO_MAX_ANGLE);

    Serial.println("Door Close");

    server.send(
        200,
        "text/plain",
        "Door Close"
    );
}

String buildAutomaticClothesStatusJson(bool raining) {

    String jsonData = "{";

    jsonData += "\"automatic\":";
    jsonData += automaticClothesMode ? "true" : "false";
    jsonData += ",";

    jsonData += "\"raining\":";
    jsonData += raining ? "true" : "false";
    jsonData += ",";

    jsonData += "\"clothesline\":";
    jsonData += clotheslineExtended ? "true" : "false";

    jsonData += "}";

    return jsonData;
}

void extendClothesline() {

    moveClothesServo(SERVO_MIN_ANGLE);
    clotheslineExtended = true;

    Serial.println("Clothesline Extended");
}

void retractClothesline() {

    moveClothesServo(SERVO_MAX_ANGLE);
    clotheslineExtended = false;

    Serial.println("Clothesline Retracted");
}

void manualExtendClothesline() {

    automaticClothesMode = false;
    extendClothesline();

    server.send(
        200,
        "application/json",
        buildAutomaticClothesStatusJson(
            digitalRead(RAIN_SENSOR_PIN) == rainDetectedLevel
        )
    );
}

void manualRetractClothesline() {

    automaticClothesMode = false;
    retractClothesline();

    server.send(
        200,
        "application/json",
        buildAutomaticClothesStatusJson(
            digitalRead(RAIN_SENSOR_PIN) == rainDetectedLevel
        )
    );
}

void setAutomaticClothesMode(bool enabled) {

    automaticClothesMode = enabled;

    Serial.print("Automatic clothes mode ");
    Serial.println(enabled ? "ON" : "OFF");

    server.send(
        200,
        "application/json",
        buildAutomaticClothesStatusJson(
            digitalRead(RAIN_SENSOR_PIN) == rainDetectedLevel
        )
    );
}

void handleAutomaticClothes(bool raining) {

    if(!automaticClothesMode) {
        return;
    }

    if(raining && clotheslineExtended) {
        retractClothesline();
        Serial.println("AUTO: RAIN - CLOTHESLINE RETRACTED");
    } else if(!raining && !clotheslineExtended) {
        extendClothesline();
        Serial.println("AUTO: DRY - CLOTHESLINE EXTENDED");
    }
}

void handleAutomaticYardLight(int lightValue, bool motionDetected) {

    if(!automaticYardLightMode) {
        return;
    }

    bool shouldTurnOn = lightValue > darkLightValue && motionDetected;

    if(shouldTurnOn != yardLightState) {
        applyYardLight(shouldTurnOn);

        Serial.println(
            shouldTurnOn
            ? "AUTO: DARK + MOTION - YARD LIGHT ON"
            : "AUTO: NO MOTION OR BRIGHT - YARD LIGHT OFF"
        );
    }
}

void registerDeviceRoutes() {

    server.on("/device/25/on", []() { setManualLight(LIGHT1, light1State, true, "LIGHT1"); });
    server.on("/device/25/off", []() { setManualLight(LIGHT1, light1State, false, "LIGHT1"); });
    server.on("/device/2/on", []() { setManualLight(LIGHT1, light1State, true, "LIGHT1"); });
    server.on("/device/2/off", []() { setManualLight(LIGHT1, light1State, false, "LIGHT1"); });

    server.on("/device/26/on", []() { setManualLight(LIGHT2, light2State, true, "LIGHT2"); });
    server.on("/device/26/off", []() { setManualLight(LIGHT2, light2State, false, "LIGHT2"); });
    server.on("/device/6/on", []() { setManualLight(LIGHT2, light2State, true, "LIGHT2"); });
    server.on("/device/6/off", []() { setManualLight(LIGHT2, light2State, false, "LIGHT2"); });

    server.on("/device/27/on", []() { setManualLight(LIGHT3, light3State, true, "LIGHT3"); });
    server.on("/device/27/off", []() { setManualLight(LIGHT3, light3State, false, "LIGHT3"); });
    server.on("/device/7/on", []() { setManualLight(LIGHT3, light3State, true, "LIGHT3"); });
    server.on("/device/7/off", []() { setManualLight(LIGHT3, light3State, false, "LIGHT3"); });

    server.on("/device/32/on", []() { setManualLight(LIGHT4, light4State, true, "LIGHT4"); });
    server.on("/device/32/off", []() { setManualLight(LIGHT4, light4State, false, "LIGHT4"); });
    server.on("/device/10/on", []() { setManualLight(LIGHT4, light4State, true, "LIGHT4"); });
    server.on("/device/10/off", []() { setManualLight(LIGHT4, light4State, false, "LIGHT4"); });

    server.on("/device/33/on", []() { setManualYardLight(true); });
    server.on("/device/33/off", []() { setManualYardLight(false); });

    server.on("/device/21/on", openDoor);
    server.on("/device/21/off", closeDoor);
    server.on("/device/5/on", openDoor);
    server.on("/device/5/off", closeDoor);

    server.on("/device/14/on", manualExtendClothesline);
    server.on("/device/14/off", manualRetractClothesline);

    server.on("/automatic-light/on", []() { setAutomaticLightMode(true); });
    server.on("/automatic-light/off", []() { setAutomaticLightMode(false); });
    server.on("/automatic-light/status", []() {
        server.send(
            200,
            "application/json",
            buildAutomaticStatusJson()
        );
    });

    server.on("/automatic-clothes/on", []() { setAutomaticClothesMode(true); });
    server.on("/automatic-clothes/off", []() { setAutomaticClothesMode(false); });
    server.on("/automatic-clothes/status", []() {
        server.send(
            200,
            "application/json",
            buildAutomaticClothesStatusJson(
                digitalRead(RAIN_SENSOR_PIN) == rainDetectedLevel
            )
        );
    });

    server.on("/automatic-yard-light/on", []() { setAutomaticYardLightMode(true); });
    server.on("/automatic-yard-light/off", []() { setAutomaticYardLightMode(false); });
    server.on("/automatic-yard-light/status", []() {
        server.send(
            200,
            "application/json",
            buildAutomaticYardLightStatusJson(
                digitalRead(PIR_SENSOR_PIN) == HIGH,
                analogRead(LIGHT_SENSOR_PIN)
            )
        );
    });
}

void buzzerSin(int pin){
    buzzerActive = true;
}

void stopBuzzerSin() {
    buzzerActive = false;
    buzzerSinStep = 0;
    ledcWriteTone(BUZZER_CHANNEL, 0);
}

void updateBuzzerSin(unsigned long now) {
    if(!buzzerActive) {
        return;
    }

    if(now - lastBuzzerStepMs < BUZZER_STEP_INTERVAL_MS) {
        return;
    }

    lastBuzzerStepMs = now;

    float rad = buzzerSinStep * 3.14 / 180;
    int freq = 2000 + 800 * sin(rad);

    ledcWriteTone(BUZZER_CHANNEL, freq);

    buzzerSinStep++;

    if(buzzerSinStep >= 180) {
        buzzerSinStep = 0;
    }
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
    pinMode(YARD_LIGHT_PIN, OUTPUT);
    pinMode(BTN_LIGHT1, INPUT_PULLUP);
    pinMode(BTN_LIGHT2, INPUT_PULLUP);
    pinMode(BTN_LIGHT3, INPUT_PULLUP);
    pinMode(BTN_LIGHT4, INPUT_PULLUP);

    digitalWrite(LIGHT1, LOW);
    digitalWrite(LIGHT2, LOW);
    digitalWrite(LIGHT3, LOW);
    digitalWrite(LIGHT4, LOW);
    digitalWrite(YARD_LIGHT_PIN, LOW);

    /*
        CLOTHESLINE SERVO
    */
    ESP32PWM::allocateTimer(0);
    ESP32PWM::allocateTimer(1);
    ESP32PWM::allocateTimer(2);
    ESP32PWM::allocateTimer(3);

    clothesServo.setPeriodHertz(50);
    clothesServo.attach(CLOTHES_SERVO_PIN, 500, 2400);
    moveClothesServo(SERVO_MAX_ANGLE);

    /*
        BUZZER
    */

    pinMode(BUZZER_PIN, OUTPUT);
    ledcSetup(BUZZER_CHANNEL, 2000, BUZZER_RESOLUTION);
    ledcAttachPin(BUZZER_PIN, BUZZER_CHANNEL);
    ledcWriteTone(BUZZER_CHANNEL, 0);
    pinMode(LIGHT_SENSOR_PIN, INPUT); 
    pinMode(RAIN_SENSOR_PIN, INPUT);
    pinMode(PIR_SENSOR_PIN, INPUT);


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
    updateDoorServo(now);
    updateBuzzerSin(now);
    handleLightButtons(now);

    if(now - lastSensorReadMs < SENSOR_INTERVAL_MS) {

        return;
    }

    lastSensorReadMs = now;

    /*
        READ GAS SENSOR
    */

    int gasValue =
        analogRead(MQ2_PIN);

    int lightValue =
        analogRead(LIGHT_SENSOR_PIN);

    int rainValue =
        digitalRead(RAIN_SENSOR_PIN);

    bool raining =
        rainValue == rainDetectedLevel;

    bool motionDetected =
        digitalRead(PIR_SENSOR_PIN) == HIGH;

    float temperature =
        dht.readTemperature();

    float humidity =
        dht.readHumidity();

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

    Serial.print("Light: ");
    Serial.println(lightValue);

    Serial.print("Rain: ");
    Serial.println(raining ? "YES" : "NO");

    Serial.print("Motion: ");
    Serial.println(motionDetected ? "YES" : "NO");

    Serial.print("Temperature: ");
    Serial.println(temperature);

    Serial.print("Humidity: ");
    Serial.println(humidity);

    /*
        GAS ALERT
    */

    if(gasValue >= maxGasValue) {
        buzzerSin(BUZZER_PIN);

        Serial.println(
            "WARNING: GAS DETECTED"
        );

    } else {
        stopBuzzerSin();
    }

    /*
        AUTOMATIC LIGHT CONTROL
        This LDR reads high when dark and low when bright.
    */

    if(automaticLightMode) {

        if(lightValue > darkLightValue && !automaticLightsOn) {

            setAllLights(true);
            Serial.println("AUTO: DARK - LIGHTS ON");

        } else if(lightValue < brightLightValue && automaticLightsOn) {

            setAllLights(false);
            Serial.println("AUTO: BRIGHT - LIGHTS OFF");
        }
    }

    /*
        AUTOMATIC CLOTHESLINE CONTROL
    */

    handleAutomaticClothes(raining);

    /*
        AUTOMATIC YARD LIGHT CONTROL
        LDR reads high when dark. PIR reads HIGH when motion is detected.
    */

    handleAutomaticYardLight(lightValue, motionDetected);

    /*
        SEND DATA TO FASTAPI
    */

    if(WiFi.status() == WL_CONNECTED) {

        if(now < sensorPostBackoffUntilMs) {

            Serial.println("Sensor POST skipped during backend backoff");

        } else {

            bool posted = sendEnvironmentData(
                gasValue,
                lightValue,
                rainValue,
                raining,
                motionDetected,
                temperature,
                humidity
            );

            if(posted) {

                failedSensorPostCount = 0;

            } else {

                failedSensorPostCount++;

                if(failedSensorPostCount >= 3) {

                    sensorPostBackoffUntilMs =
                        millis() + SENSOR_POST_BACKOFF_MS;

                    failedSensorPostCount = 0;

                    Serial.println(
                        "Backend slow. Sensor POST paused for 15 seconds"
                    );
                }
            }
        }
    }

}
