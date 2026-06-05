#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <ESP32Servo.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <time.h>

bool hasNewMessage = false;
bool isAuthorized = false;
String reason = "";
const char* ssid = "iPhone";
const char* password = "12346789";

const char* AWS_IOT_ENDPOINT = "a5yjq0s3thy6p-ats.iot.ap-southeast-1.amazonaws.com";
String clientId = "ESP32_DevKitV1_Door";
String subscribeTopic;

#define SERVO_PIN 18
#define I2C_SDA 21
#define I2C_SCL 22

LiquidCrystal_I2C lcd(0x27, 16, 2);
Servo doorServo;

WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);

String rootCA;
String deviceCert;
String privateKey;

// Non-blocking timers
unsigned long lastWiFiCheckTime = 0;
unsigned long lastMqttCheckTime = 0;

unsigned long doorOpenTime = 0;
bool isDoorOpen = false;
const unsigned long DOOR_OPEN_DURATION = 5000;

unsigned long screenMessageTime = 0;
bool isShowingMessage = false;
const unsigned long SCREEN_MESSAGE_DURATION = 10000;

String readFile(const char* path) {
    File file = LittleFS.open(path, "r");
    if(!file) {
        Serial.println("Failed to open file: " + String(path));
        return "";
    }
    String fileContent = file.readString();
    file.close();
    return fileContent;
}

void showScreen(const String& line1, const String& line2) {
    lcd.clear();
    lcd.setCursor(0,0);
    lcd.print(line1);
    lcd.setCursor(0,1);
    lcd.print(line2);
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
    String message;
    for(int i = 0; i < length; i++) {
        message += (char)payload[i];
    }
    Serial.println("Received message on topic: " + String(topic) + " | Message: " + message);

    DynamicJsonDocument doc(256);
    DeserializationError error = deserializeJson(doc, message);
    if(error) {
        Serial.println("ERROR: Failed to parse JSON: " + String(error.c_str()));
        return;
    }
    if(doc.containsKey("authorized")) {
        isAuthorized = doc["authorized"];
        reason = "No message";
        if(doc.containsKey("message")) {
            reason = doc["message"].as<String>();
        }

        if(reason.length() > 16) {
            reason = reason.substring(0, 16);
        }
        hasNewMessage = true;
    }
}

void setup() {
    Serial.begin(115200);
    Wire.begin(I2C_SDA, I2C_SCL);
    lcd.init();
    lcd.backlight();
    showScreen("Booting up...", "");

    doorServo.setPeriodHertz(50);
    doorServo.attach(SERVO_PIN, 500, 2400);
    doorServo.write(0);
    
    WiFi.begin(ssid, password);
    Serial.println("INFO: Connecting to WiFi ...");
    showScreen("Connecting WiFi", "");
    while(WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\nINFO: Connected to WiFi successfully.");
    
    String macAddress = WiFi.macAddress();
    subscribeTopic = "smart-home/doors/" + macAddress + "/command";
    Serial.println("INFO: MAC Address: " + macAddress);

    // Sync time for AWS certificate validation
    configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
    Serial.print("INFO: Waiting for NTP time sync: ");
    showScreen("Syncing NTP Time", "");
    time_t now = time(nullptr);
    while (now < 1600000000) {
        delay(500);
        Serial.print(".");
        now = time(nullptr);
    }
    Serial.println("");
    struct tm timeinfo;
    gmtime_r(&now, &timeinfo);
    Serial.print("INFO: Current time: ");
    Serial.print(asctime(&timeinfo));

    if(!LittleFS.begin(true)) {
        Serial.println("ERROR: Failed to mount LittleFS");
        showScreen("ERROR:", "LittleFS Mount");
        while(true);
    }

    rootCA = readFile("/rootCA.pem");
    deviceCert = readFile("/deviceCert.crt");
    privateKey = readFile("/privateKey.key");

    if(rootCA != "" && deviceCert != "" && privateKey != "") {
        secureClient.setCACert(rootCA.c_str());
        secureClient.setCertificate(deviceCert.c_str());
        secureClient.setPrivateKey(privateKey.c_str());
        Serial.println("INFO: Certificates loaded successfully.");
    } else {
        Serial.println("ERROR: Failed to loading certificates.");
        showScreen("ERROR:", "Load Certs");
        while(true);
    } 
    
    mqttClient.setServer(AWS_IOT_ENDPOINT, 8883);
    mqttClient.setCallback(mqttCallback);
    
    showScreen("Connecting MQTT", "");
}

void loop() {
    unsigned long currentMillis = millis();

    // 1. Check WiFi Connection
    if (WiFi.status() != WL_CONNECTED) {
        if (currentMillis - lastWiFiCheckTime >= 5000) {
            Serial.println("WARNING: WiFi disconnected. Reconnecting...");
            showScreen("WiFi Lost", "Reconnecting...");
            WiFi.disconnect();
            WiFi.begin(ssid, password);
            lastWiFiCheckTime = currentMillis;
        }
        return; 
    }

    // 2. Check MQTT Connection
    if (!mqttClient.connected()) {
        if (currentMillis - lastMqttCheckTime >= 5000) {
            Serial.println("INFO: Reconnecting to MQTT...");
            showScreen("MQTT Lost", "Reconnecting...");
            if (mqttClient.connect(clientId.c_str())) {
                Serial.println("INFO: Connected to MQTT successfully.");
                mqttClient.subscribe(subscribeTopic.c_str());
                Serial.println("INFO: Listening at topic: " + subscribeTopic);
                showScreen("SMART SECURITY", "DOOR LOCK SYSTEM");
                isShowingMessage = false; 
            } else {
                Serial.println("ERROR: MQTT connect failed, state " + String(mqttClient.state()));
            }
            lastMqttCheckTime = currentMillis;
        }
        return; 
    }

    mqttClient.loop();

    // 3. Handle incoming message logic
    if(hasNewMessage) {
        hasNewMessage = false;
        if(isAuthorized) {
            Serial.println("INFO: Accepting face! Opening the door...");
            showScreen("WELCOME IN!", "");
            doorServo.write(90);
            isDoorOpen = true;
            doorOpenTime = currentMillis;
            isShowingMessage = true;
            screenMessageTime = currentMillis;
        } else {
            Serial.println("INFO: Access denied! " + String(reason));
            showScreen("ACCESS DENIED!", reason);
            isShowingMessage = true;
            screenMessageTime = currentMillis;
            // Force door to close immediately if it was open (optional safety)
            if (isDoorOpen) {
                doorServo.write(0);
                isDoorOpen = false;
            }
        }
    }

    // 4. Handle Door Auto-Close
    if (isDoorOpen && (currentMillis - doorOpenTime >= DOOR_OPEN_DURATION)) {
        Serial.println("INFO: Auto-closing the door...");
        doorServo.write(0);
        isDoorOpen = false;
        showScreen("DOOR CLOSED!", "");
        isShowingMessage = true;
        screenMessageTime = currentMillis; // Reset message timer for "DOOR CLOSED!"
    }

    // 5. Handle Screen Message Auto-Clear
    if (isShowingMessage && !isDoorOpen && (currentMillis - screenMessageTime >= SCREEN_MESSAGE_DURATION)) {
        showScreen("SMART SECURITY", "DOOR LOCK SYSTEM");
        isShowingMessage = false;
    }
}