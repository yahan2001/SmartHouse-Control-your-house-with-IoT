#include <Arduino.h>

#define LIGHT1 25
#define LIGHT2 26
#define LIGHT3 27
#define LIGHT4 32

void setup() {
  Serial.begin(115200);

  pinMode(LIGHT1, OUTPUT);
  pinMode(LIGHT2, OUTPUT);
  pinMode(LIGHT3, OUTPUT);
  pinMode(LIGHT4, OUTPUT);

  // Tắt hết lúc khởi động
  digitalWrite(LIGHT1, LOW);
  digitalWrite(LIGHT2, LOW);
  digitalWrite(LIGHT3, LOW);
  digitalWrite(LIGHT4, LOW);

  Serial.println("ESP32 Started");
}

void loop() {

  Serial.println("ALL ON");

  digitalWrite(LIGHT1, HIGH);
  digitalWrite(LIGHT2, HIGH);
  digitalWrite(LIGHT3, HIGH);
  digitalWrite(LIGHT4, HIGH);

  delay(5000);

  Serial.println("ALL OFF");

  digitalWrite(LIGHT1, LOW);
  digitalWrite(LIGHT2, LOW);
  digitalWrite(LIGHT3, LOW);
  digitalWrite(LIGHT4, LOW);

  delay(5000);
}