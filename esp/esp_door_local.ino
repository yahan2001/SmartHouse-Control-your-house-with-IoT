#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Keypad.h>
#include <Preferences.h>

const char* ssid = "YOUR_WIFI";
const char* password = "YOUR_PASSWORD";

#define SERVO_PIN 18
#define I2C_SDA 21
#define I2C_SCL 22

const byte KEYPAD_ROWS = 4;
const byte KEYPAD_COLS = 4;
char keypadKeys[KEYPAD_ROWS][KEYPAD_COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};
byte keypadRowPins[KEYPAD_ROWS] = {13, 14, 25, 26};
byte keypadColPins[KEYPAD_COLS] = {27, 32, 33, 19};

const int DOOR_CLOSED_ANGLE = 0;
const int DOOR_OPEN_ANGLE = 90;
const unsigned long DOOR_OPEN_DURATION_MS = 5000;
const unsigned long SCREEN_MESSAGE_DURATION_MS = 10000;

WebServer server(80);
Servo doorServo;
LiquidCrystal_I2C lcd(0x27, 16, 2);
Keypad keypad = Keypad(
  makeKeymap(keypadKeys),
  keypadRowPins,
  keypadColPins,
  KEYPAD_ROWS,
  KEYPAD_COLS
);
Preferences preferences;

bool doorOpen = false;
bool showingMessage = false;
unsigned long doorOpenedAtMs = 0;
unsigned long messageShownAtMs = 0;
String doorPassword = "1234";
String typedPassword = "";

void showScreen(const String& line1, const String& line2) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1.substring(0, 16));
  lcd.setCursor(0, 1);
  lcd.print(line2.substring(0, 16));
  showingMessage = true;
  messageShownAtMs = millis();
}

void showIdleScreen() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("SMART SECURITY");
  lcd.setCursor(0, 1);
  lcd.print("Enter password");
  showingMessage = false;
}

void showPasswordInput() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Password:");
  lcd.setCursor(0, 1);
  for (int i = 0; i < typedPassword.length() && i < 16; i++) {
    lcd.print("*");
  }
  showingMessage = false;
}

void openDoor() {
  String message = server.hasArg("message") ? server.arg("message") : "Authorized";
  doorServo.write(DOOR_OPEN_ANGLE);
  doorOpen = true;
  doorOpenedAtMs = millis();
  showScreen("WELCOME IN", message);
  server.send(200, "application/json", "{\"door\":\"open\"}");
}

void openDoorFromKeypad() {
  doorServo.write(DOOR_OPEN_ANGLE);
  doorOpen = true;
  doorOpenedAtMs = millis();
  showScreen("WELCOME IN", "Password OK");
}

void closeDoor() {
  doorServo.write(DOOR_CLOSED_ANGLE);
  doorOpen = false;
  showScreen("DOOR CLOSED", "");
  server.send(200, "application/json", "{\"door\":\"closed\"}");
}

void denyDoor() {
  String message = server.hasArg("message") ? server.arg("message") : "Access denied";
  if (doorOpen) {
    doorServo.write(DOOR_CLOSED_ANGLE);
    doorOpen = false;
  }
  showScreen("ACCESS DENIED", message);
  server.send(200, "application/json", "{\"door\":\"denied\"}");
}

void updatePassword() {
  String nextPassword = server.hasArg("value") ? server.arg("value") : "";
  nextPassword.trim();

  if (nextPassword.length() < 4 || nextPassword.length() > 12) {
    server.send(
      400,
      "application/json",
      "{\"message\":\"Password length must be 4-12 digits\"}"
    );
    return;
  }

  for (int i = 0; i < nextPassword.length(); i++) {
    if (!isDigit(nextPassword.charAt(i))) {
      server.send(
        400,
        "application/json",
        "{\"message\":\"Password must contain digits only\"}"
      );
      return;
    }
  }

  doorPassword = nextPassword;
  preferences.putString("password", doorPassword);
  typedPassword = "";
  showScreen("PASSWORD SAVED", "");
  server.send(200, "application/json", "{\"message\":\"password updated\"}");
}

void handleKeypad() {
  char key = keypad.getKey();
  if (!key) {
    return;
  }

  if (key >= '0' && key <= '9') {
    if (typedPassword.length() < 12) {
      typedPassword += key;
      showPasswordInput();
    }
    return;
  }

  if (key == '*') {
    typedPassword = "";
    showIdleScreen();
    return;
  }

  if (key == '#') {
    if (typedPassword == doorPassword) {
      typedPassword = "";
      openDoorFromKeypad();
    } else {
      typedPassword = "";
      showScreen("WRONG PASSWORD", "Try again");
    }
  }
}

void setup() {
  Serial.begin(115200);

  Wire.begin(I2C_SDA, I2C_SCL);
  lcd.init();
  lcd.backlight();
  showScreen("Booting", "");

  doorServo.setPeriodHertz(50);
  doorServo.attach(SERVO_PIN, 500, 2400);
  doorServo.write(DOOR_CLOSED_ANGLE);

  preferences.begin("door", false);
  doorPassword = preferences.getString("password", "1234");

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  showScreen("Connecting WiFi", "");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("ESP32 Door IP: ");
  Serial.println(WiFi.localIP());

  server.on("/door/open", HTTP_GET, openDoor);
  server.on("/door/close", HTTP_GET, closeDoor);
  server.on("/door/deny", HTTP_GET, denyDoor);
  server.on("/door/password", HTTP_GET, updatePassword);
  server.on("/door/status", HTTP_GET, []() {
    server.send(
      200,
      "application/json",
      String("{\"open\":") + (doorOpen ? "true" : "false") + "}"
    );
  });
  server.begin();

  showIdleScreen();
}

void loop() {
  server.handleClient();
  handleKeypad();

  unsigned long now = millis();

  if (doorOpen && now - doorOpenedAtMs >= DOOR_OPEN_DURATION_MS) {
    doorServo.write(DOOR_CLOSED_ANGLE);
    doorOpen = false;
    showScreen("DOOR CLOSED", "");
  }

  if (showingMessage && !doorOpen && now - messageShownAtMs >= SCREEN_MESSAGE_DURATION_MS) {
    showIdleScreen();
  }
}
