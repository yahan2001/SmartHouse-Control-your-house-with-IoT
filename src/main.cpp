#include <WiFi.h>
#include <WebServer.h>

const char* ssid = "TTHocLieuT1";
const char* password = "hoclieut1";

WebServer server(80);

#define LED 2

void handleOn() {
  digitalWrite(LED, HIGH);
  server.send(200, "text/plain", "LED ON");
}

void handleOff() {
  digitalWrite(LED, LOW);
  server.send(200, "text/plain", "LED OFF");
}

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }

  Serial.println(WiFi.localIP()); // xem IP ESP32

  server.on("/on", handleOn);
  server.on("/off", handleOff);

  server.begin();
}

void loop() {
  server.handleClient();
}