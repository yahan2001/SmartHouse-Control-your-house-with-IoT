#include <WiFi.h>
#include <WebServer.h>
#include "esp_http_server.h"
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include "esp_camera.h"
#include "mbedtls/md.h"

struct AWSCredentials {
  String accessKeyId;
  String secretAccessKey;
  String sessionToken;
  bool isValid = false;
};

// Hàm 1: Lấy giờ chuẩn UTC định dạng ISO8601
String getISO8601Time(time_t now, bool dateOnly) {
  struct tm timeinfo;
  gmtime_r(&now, &timeinfo);
  char buf[20];
  if (dateOnly) strftime(buf, sizeof(buf), "%Y%m%d", &timeinfo);
  else strftime(buf, sizeof(buf), "%Y%m%dT%H%M%SZ", &timeinfo);
  return String(buf);
}

// Hàm 2: Thuật toán SHA256
String getSHA256(String data) {
  byte shaResult[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 0);
  mbedtls_md_starts(&ctx);
  mbedtls_md_update(&ctx, (const unsigned char*)data.c_str(), data.length());
  mbedtls_md_finish(&ctx, shaResult);
  mbedtls_md_free(&ctx);
  
  String hexStr = "";
  for (int i = 0; i < 32; i++) {
    char buf[3];
    sprintf(buf, "%02x", shaResult[i]);
    hexStr += buf;
  }
  return hexStr;
}

// Hàm 3: Thuật toán HMAC-SHA256
void getHMAC256(const byte* key, int keyLen, String data, byte* result) {
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, key, keyLen);
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)data.c_str(), data.length());
  mbedtls_md_hmac_finish(&ctx, result);
  mbedtls_md_free(&ctx);
}

// ================= CẤU HÌNH MẠNG & AWS =================
const char* ssid = "iPhone";
const char* password = "12346789";

const char* AWS_IOT_ENDPOINT = "xxxxxx-ats.iot.ap-southeast-1.amazonaws.com"; // Thay bằng Endpoint thực tế
const char* CREDENTIAL_ENDPOINT = "c1thecko6nl33d.credentials.iot.ap-southeast-1.amazonaws.com";
const char* ROLE_ALIAS = "smart-house-role-alias";
const char* MAC_ADDRESS = "F4:65:0B:58:24:1C"; 
const char* MQTT_TOPIC_CMD = "smart-home/doors/AA:BB:CC:DD:EE:FF/command"; // Not used 
const char* S3_BUCKET_NAME = "smart-house-4869";
const char* AWS_REGION = "ap-southeast-1";

// ================= CẤU HÌNH PHẦN CỨNG =================
#define BUTTON_PIN 12
#define LED_PIN 14

// Cấu hình chân cho Camera AI-Thinker
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// ================= BIẾN TOÀN CỤC =================
WebServer server(80);
WiFiClientSecure secureClient;
String rootCA;
String deviceCert;
String privateKey;
// PubSubClient mqttClient(secureClient);

unsigned long motionDetectedTime = 0;
bool isWaitingToCapture = false;
bool captureFlag = false;
int lastButtonState = HIGH;



// ================= HÀM PHỤ TRỢ =================
String readFile(const char* path) {
  File file = LittleFS.open(path, "r");
  if (!file) {
    Serial.println("ERROR: Không thể mở file " + String(path));
    return "";
  }
  String fileContent = file.readString();
  file.close();
  return fileContent;
}

// ================= KHỞI TẠO CAMERA =================
void setupCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  
  if(psramFound()){
    config.frame_size = FRAMESIZE_VGA; // Đã sửa từ UXGA về VGA (640x480) để stream mượt mà, nhưng vẫn đủ nét cho Rekognition
    config.jpeg_quality = 20; // Giảm chất lượng ảnh 1 chút để nhẹ băng thông
    config.fb_count = 2; // Tăng bộ đệm lên 2 để chạy song song mượt mà Livestream và Chụp ảnh AWS
  }
  // } else {
  //   config.frame_size = FRAMESIZE_VGA;
  //   config.jpeg_quality = 12;
  //   config.fb_count = 1;
  // }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("ERROR: Cannot initiate Camera: 0x%x\n", err);
  } else {
    Serial.println("INFO: Camera initiates successfully");
  }
}

// ================= KHỞI TẠO MQTT =================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (int i = 0; i < length; i++) message += (char)payload[i];
  
  Serial.printf("Nhận lệnh MQTT [%s]: %s\n", topic, message.c_str());
  
  // Có thể mở rộng xử lý lệnh thủ công từ MQTT tại đây nếu cần
}

// void setupMQTT() {
//   mqttClient.setServer(AWS_IOT_ENDPOINT, 8883);
//   mqttClient.setCallback(mqttCallback);
  
//   if (!mqttClient.connected()) {
//     Serial.print("Connecting to the MQTT...");
//     if (mqttClient.connect("ESP32_CAM_Thing")) {
//       Serial.println("Successfully!");
//       mqttClient.subscribe(MQTT_TOPIC_CMD);
//     } else {
//       Serial.print("ERROR: MQTT Server can not be started...");
//       Serial.println(mqttClient.state());
//     }
//   }
// }

// ================= GIAO TIẾP AWS =================
//AWSCredentials getTemporaryCredentials() {
//  AWSCredentials creds;
//  HTTPClient http;
//  
//  String url = String("https://") + CREDENTIAL_ENDPOINT + "/role-aliases/" + ROLE_ALIAS + "/credentials";
//  http.begin(secureClient, url);
//  http.addHeader("x-amzn-iot-thingname", "esp32"); 
//  Serial.println("\n=== THÔNG TIN DEBUG ===");
//  Serial.printf("1. Trạng thái WiFi: %d (Số 3 là WL_CONNECTED)\n", WiFi.status());
//  Serial.println("2. URL đang gọi: " + url);
//  Serial.printf("3. RAM còn trống: %d bytes\n", ESP.getFreeHeap());
//  Serial.println("========================\n");
//  int httpCode = http.GET();
//  if (httpCode == 200) {
//    String payload = http.getString();
//    DynamicJsonDocument doc(2048);
//    deserializeJson(doc, payload);
//    
//    creds.accessKeyId = doc["credentials"]["accessKeyId"].as<String>();
//    creds.secretAccessKey = doc["credentials"]["secretAccessKey"].as<String>();
//    creds.sessionToken = doc["credentials"]["sessionToken"].as<String>();
//    creds.isValid = true;
//    Serial.println("Got the keys from S3!");
//  } else {
//    Serial.printf("ERROR: Cannot get the key (HTTP %d)\n", httpCode);
//    String errorPayload = http.getString();
//    Serial.println("Chi tiết lỗi từ AWS: " + errorPayload);
//  }
//  http.end();
//  return creds;
//}
AWSCredentials getTemporaryCredentials() {
  AWSCredentials creds;
  HTTPClient http;
  String url = "https://" + String(CREDENTIAL_ENDPOINT) + "/role-aliases/" + String(ROLE_ALIAS) + "/credentials";
  Serial.println("\n🔗 Đang gọi URL: " + url);
  
  http.setTimeout(20000);
  secureClient.setTimeout(20000);
  http.begin(secureClient, url);
  
  // Đừng quên sửa chữ "esp32" dưới đây thành tên Thing thực tế nếu bạn đã đổi tên nhé!
//  http.addHeader("x-amzn-iot-thingname", "esp32");  
//  Serial.printf("Free heap trước GET: %d\n", ESP.getFreeHeap());
//  Serial.printf("Free PSRAM: %d\n", ESP.getFreePsram());
  int httpCode = http.GET();
  Serial.printf("📡 HTTP Code: %d\n", httpCode);

  if (httpCode == 200) {
    String payload = http.getString();
    Serial.println("✅ Lấy khóa thành công!");
    
    DynamicJsonDocument doc(2048);
    deserializeJson(doc, payload);
    
    creds.accessKeyId = doc["credentials"]["accessKeyId"].as<String>();
    creds.secretAccessKey = doc["credentials"]["secretAccessKey"].as<String>();
    creds.sessionToken = doc["credentials"]["sessionToken"].as<String>();
    creds.isValid = true;
    
  } else if (httpCode > 0) {
    // Nếu kết nối được nhưng bị AWS từ chối (HTTP 403, 404, v.v.)
    String errorPayload = http.getString();
    Serial.println("❌ AWS trả về lỗi chi tiết: " + errorPayload);
    
  } else {
    // Nếu kết nối bị đứt gánh giữa đường (HTTP -1)
    Serial.println("❌ Lỗi thư viện HTTP: " + http.errorToString(httpCode));
    
    // Moi lỗi bảo mật SSL/TLS ra xem
    char err_buf[100];
    if (secureClient.lastError(err_buf, sizeof(err_buf))) {
      Serial.print("🔍 Nguyên nhân SSL/TLS: ");
      Serial.println(err_buf);
    } else {
      Serial.println("🔍 Nguyên nhân: AWS đóng cổng đột ngột (Server ngắt kết nối).");
    }
  }

  http.end();
  return creds;
}

// void uploadToS3(AWSCredentials creds, camera_fb_t * fb) {
//   // LƯU Ý: Đây là cấu trúc Request tải lên S3. 
//   // Bạn CẦN sử dụng một thư viện AWS SigV4 (như aws-sigv4-arduino) 
//   // để tạo ra chữ ký "Authorization Header" hợp lệ tính toán từ secretAccessKey.
  
//   HTTPClient http;
//   String objectKey = String("door-access-images/") + MAC_ADDRESS + "/" + String(millis()) + ".jpg";
//   String url = String("https://") + S3_BUCKET_NAME + ".s3." + AWS_REGION + ".amazonaws.com/" + objectKey;

//   http.begin(secureClient, url);
  
//   // Các Header bắt buộc cho AWS SigV4
//   http.addHeader("Content-Type", "image/jpeg");
//   http.addHeader("x-amz-security-token", creds.sessionToken);
//   // http.addHeader("x-amz-date", "NGÀY_GIỜ_CHUẨN_ISO8601");
//   // http.addHeader("Authorization", "CHỮ_KÝ_SIGV4_ĐƯỢC_TẠO_TỪ_THƯ_VIỆN");

//   Serial.println("Đang đẩy ảnh lên S3...");
//   int httpResponsobjectKeyeCode = http.PUT(fb->buf, fb->len);
  
//   if (httpResponseCode == 200) {
//     Serial.println("✅ Upload thành công lên S3!");
//   } else {
//     Serial.printf("❌ Upload thất bại. Mã lỗi: %d\n", httpResponseCode);
//     Serial.println(http.getString());
//   }
//   http.end();
// }



void uploadToS3(AWSCredentials creds, camera_fb_t * fb) {
  HTTPClient http;
  
    // Lấy giờ hiện tại
  time_t now;
  time(&now);
  String amzDate = getISO8601Time(now, false);
  String shortDate = getISO8601Time(now, true);
  // Dùng dấu gạch ngang thay vì dấu hai chấm cho địa chỉ MAC để tránh lỗi URL Parsing
  String cleanMac = String(MAC_ADDRESS);
  cleanMac.replace(":", "-");
  String objectKey = String("door-access-images/") + cleanMac + "/" + String(now) + ".jpg";
  
  String host = String(S3_BUCKET_NAME) + ".s3." + AWS_REGION + ".amazonaws.com";
  String url = String("https://") + host + "/" + objectKey;



  // --- BẮT ĐẦU TẠO CHỮ KÝ SIGV4 ---
  // 1. Tạo Canonical Request
  String canonicalUri = "/" + objectKey;
  String canonicalHeaders = "host:" + host + "\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:" + amzDate + "\nx-amz-security-token:" + creds.sessionToken + "\n";
  String signedHeaders = "host;x-amz-content-sha256;x-amz-date;x-amz-security-token";
  String payloadHash = "UNSIGNED-PAYLOAD"; // Báo với AWS không cần kiểm tra nội dung ảnh
  String canonicalRequest = "PUT\n" + canonicalUri + "\n\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + payloadHash;

  // 2. Tạo String To Sign
  String credentialScope = shortDate + "/" + AWS_REGION + "/s3/aws4_request";
  String stringToSign = "AWS4-HMAC-SHA256\n" + amzDate + "\n" + credentialScope + "\n" + getSHA256(canonicalRequest);

  // 3. Tính toán khóa ký (Signing Key)
  String kSecretStr = "AWS4" + creds.secretAccessKey; // Lấy secretKey từ struct creds của bạn
  byte kDate[32], kRegion[32], kService[32], kSigning[32], signatureBytes[32];
  
  getHMAC256((const byte*)kSecretStr.c_str(), kSecretStr.length(), shortDate, kDate);
  getHMAC256(kDate, 32, AWS_REGION, kRegion);
  getHMAC256(kRegion, 32, "s3", kService);
  getHMAC256(kService, 32, "aws4_request", kSigning);
  getHMAC256(kSigning, 32, stringToSign, signatureBytes);

  // 4. Chuyển chữ ký sang mã HEX
  String signature = "";
  for (int i = 0; i < 32; i++) {
    char buf[3];
    sprintf(buf, "%02x", signatureBytes[i]);
    signature += buf;
  }

  // 5. Gom thành Header Authorization
  String authHeader = "AWS4-HMAC-SHA256 Credential=" + creds.accessKeyId + "/" + credentialScope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;
  // --- KẾT THÚC TẠO CHỮ KÝ ---

  // Gửi HTTP PUT lên S3
  http.begin(secureClient, url);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("x-amz-content-sha256", "UNSIGNED-PAYLOAD");
  http.addHeader("x-amz-date", amzDate);
  http.addHeader("x-amz-security-token", creds.sessionToken);
  http.addHeader("Authorization", authHeader);

  Serial.println("Đang đẩy ảnh lên S3...");
  int httpResponseCode = http.PUT(fb->buf, fb->len);
  
  if (httpResponseCode == 200) {
    Serial.println("✅ Upload thành công lên S3! " + objectKey);
  } else {
    Serial.printf("❌ Upload thất bại. Mã lỗi: %d\n", httpResponseCode);
    Serial.println("Chi tiết từ AWS: " + http.getString());
  }
  http.end();
}

// ================= MJPEG STREAM SERVER (PORT 81) =================
httpd_handle_t stream_httpd = NULL;

esp_err_t stream_handler(httpd_req_t *req) {
  camera_fb_t * fb = NULL;
  esp_err_t res = ESP_OK;
  char part_buf[64];

  // Thiết lập chuẩn phân tách HTTP cho Video (MJPEG)
  res = httpd_resp_set_type(req, "multipart/x-mixed-replace;boundary=123456789000000000000987654321");
  if(res != ESP_OK) return res;

  while(true) {
    fb = esp_camera_fb_get();
    if (!fb) continue;
    
    // Đóng gói từng khung hình đẩy đi liên tục (Stream)
    size_t hlen = snprintf(part_buf, 64, "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", fb->len);
    res = httpd_resp_send_chunk(req, (const char *)part_buf, hlen);
    if(res == ESP_OK) res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
    if(res == ESP_OK) res = httpd_resp_send_chunk(req, "\r\n--123456789000000000000987654321\r\n", 37);
    
    esp_camera_fb_return(fb);
    
    // Nếu người dùng đóng trình duyệt, ngắt vòng lặp
    if(res != ESP_OK) break; 
  }
  return res;
}

void startCameraStreamServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 81; // Stream ở cổng 81 chạy ở luồng nền (Thread) riêng của ESP-IDF
  
  httpd_uri_t stream_uri = {
    .uri       = "/stream",
    .method    = HTTP_GET,
    .handler   = stream_handler,
    .user_ctx  = NULL
  };
  
  if (httpd_start(&stream_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(stream_httpd, &stream_uri);
  }
}

// ================= WEB SERVER HANDLERS =================
void handleRoot() {
  String html = "<html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>ESP32-CAM Test</title></head>";
  html += "<body style=\"text-align:center; font-family:sans-serif; background-color:#f0f0f0;\"><h2>ESP32-CAM Smooth Live View</h2>";
  html += "<img id=\"cam\" src=\"http://" + WiFi.localIP().toString() + ":81/stream\" style=\"max-width:100%; border:2px solid black; border-radius:10px;\">";
  html += "<p>Sử dụng công nghệ <b>MJPEG (Motion JPEG)</b> chuyên nghiệp cho tốc độ cực mượt.</p></body></html>";
  server.send(200, "text/html", html);
}

void handleCapture() {
  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    server.send(500, "text/plain", "Failed to capture image");
    return;
  }
  
  server.setContentLength(fb->len);
  server.send(200, "image/jpeg", "");
  server.client().write(fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

// ================= SETUP MẶC ĐỊNH =================
void setup() {
  Serial.begin(115200);
  
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW); 

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ Đã kết nối WiFi");
  
  Serial.print("🌐 TRUY CẬP ĐỊA CHỈ NÀY ĐỂ XEM CAMERA: http://");
  Serial.println(WiFi.localIP());

  server.on("/", handleRoot);
  server.on("/capture", handleCapture);
  server.begin();
  
  // Kích hoạt luồng Stream siêu mượt
  startCameraStreamServer();

  configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("Đang đồng bộ thời gian");
  time_t now = time(nullptr);
  // Chờ đến khi số giây vượt qua mốc năm 2020 (khoảng 1.6 tỷ giây)
  while (now < 1600000000) { 
    delay(500);
    Serial.print(".");
    now = time(nullptr);
  }
  Serial.println("\n✅ Đã đồng bộ giờ chuẩn!");

  if (!LittleFS.begin(true)) {
    Serial.println("❌ Lỗi khởi tạo LittleFS");
    while (true);
  }

  rootCA = readFile("/rootCA.pem");
  deviceCert = readFile("/deviceCert.crt");
  privateKey = readFile("/privateKey.key");

  if (rootCA != "" && deviceCert != "" && privateKey != "") {
    secureClient.setCACert(rootCA.c_str());
    // secureClient.setInsecure();
    secureClient.setCertificate(deviceCert.c_str());
    secureClient.setPrivateKey(privateKey.c_str());
    Serial.println("✅ Đã nạp chứng chỉ mTLS");
  } else {
    Serial.println("❌ Thiếu chứng chỉ, hệ thống dừng hoạt động!");
    while (true);
  }

  setupCamera();
}

// ================= VÒNG LẶP CHÍNH =================
void loop() {
  // --- Xử lý các luồng truy cập web (nếu có người đang xem) ---
  server.handleClient();

  // 1. Duy trì kết nối MQTT để phòng trường hợp cần nhận lệnh khác
  // if (!mqttClient.connected()) {
  //   setupMQTT();
  // }
  // mqttClient.loop();

  // 2. Kiểm tra cảm biến hồng ngoại
  // int irState = digitalRead(IR_SENSOR_PIN); 
  // if (irState == HIGH && !isWaitingToCapture) {
  //   Serial.println("👀 Phát hiện người! Bật LED, đếm ngược 5s...");
  //   digitalWrite(LED_PIN, HIGH); 
  //   motionDetectedTime = millis(); 
  //   isWaitingToCapture = true;     
  // }

  int buttonState = digitalRead(BUTTON_PIN); 
  
  // Kích hoạt nêú: Phát hiện người (HIGH) VÀ Trạng thái trước đó là không có người (LOW)
  if (buttonState == LOW && lastButtonState == HIGH && !isWaitingToCapture) {
    Serial.println("👀 Phát hiện nhấn nút! Bật LED, đếm ngược 5s...");
    digitalWrite(LED_PIN, HIGH); 
    motionDetectedTime = millis(); 
    isWaitingToCapture = true;     
  }

  // Cập nhật lại trạng thái cũ cho vòng lặp tiếp theo
  lastButtonState = buttonState;

  // 3. Đếm ngược 5 giây bằng millis()
  if (isWaitingToCapture && (millis() - motionDetectedTime >= 5000)) {
    Serial.println("📸 Đã đủ 5s, tắt LED, bắt đầu chụp ảnh!");
    digitalWrite(LED_PIN, LOW); 
    isWaitingToCapture = false; 
    captureFlag = true;   

    if (captureFlag) {
      captureFlag = false; 
      AWSCredentials creds = getTemporaryCredentials();
      if (creds.isValid) {
      
        // --- BẮT ĐẦU ĐOẠN CODE FIX LỖI ẢNH CŨ ---
        Serial.println("Đang xả bộ đệm camera...");
        // Chụp mồi và vứt đi 1-2 khung hình cũ đang kẹt trong phần cứng
        camera_fb_t * dummy_fb = esp_camera_fb_get();
        if (dummy_fb) {
          esp_camera_fb_return(dummy_fb); // Trả lại ngay lập tức
        }
        delay(50); // Chờ một nhịp ngắn để cảm biến phơi sáng lại
        // --- KẾT THÚC XẢ BỘ ĐỆM ---

        // Bây giờ mới lấy bức ảnh thật sự ở thời điểm hiện tại
        camera_fb_t * fb = esp_camera_fb_get(); 
        if (!fb) {
          Serial.println("❌ Lỗi chụp ảnh");
        } else {
          uploadToS3(creds, fb);
          esp_camera_fb_return(fb); 
        }
      }
    }
    
  }   
}

  // 4. Luồng xử lý chụp và upload
  // if (captureFlag) {
  //   captureFlag = false; 
    
  //   AWSCredentials creds = getTemporaryCredentials();
  //   if (creds.isValid) {
      
  //     // --- BẮT ĐẦU ĐOẠN CODE FIX LỖI ẢNH CŨ ---
  //     Serial.println("Đang xả bộ đệm camera...");
  //     // Chụp mồi và vứt đi 1-2 khung hình cũ đang kẹt trong phần cứng
  //     camera_fb_t * dummy_fb = esp_camera_fb_get();
  //     if (dummy_fb) {
  //       esp_camera_fb_return(dummy_fb); // Trả lại ngay lập tức
  //     }
  //     delay(50); // Chờ một nhịp ngắn để cảm biến phơi sáng lại
  //     // --- KẾT THÚC XẢ BỘ ĐỆM ---

  //     // Bây giờ mới lấy bức ảnh thật sự ở thời điểm hiện tại
  //     camera_fb_t * fb = esp_camera_fb_get(); 
  //     if (!fb) {
  //       Serial.println("❌ Lỗi chụp ảnh");
  //     } else {
  //       uploadToS3(creds, fb);
  //       esp_camera_fb_return(fb); 
  //     }
  //   }
  // }