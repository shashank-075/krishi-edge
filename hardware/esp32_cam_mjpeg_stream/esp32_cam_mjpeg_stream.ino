#include "esp_camera.h"
#include "img_converters.h"
#include <WiFi.h>
#include <WebServer.h>

// ================= WIFI =================

const char* ssid = "why so serious?";
const char* password = "shashank89";

WebServer server(80);

// ================= AI THINKER ESP32-CAM PINS =================

#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define FLASH_GPIO_NUM     4

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

// ================= HOME PAGE =================

void handleRoot() {
  String page = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <title>AgriCold CAM</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <style>
    body {
      background: #111;
      color: white;
      text-align: center;
      font-family: Arial;
    }

    img {
      width: 95%;
      max-width: 640px;
      border: 3px solid #444;
      border-radius: 10px;
    }
  </style>
</head>

<body>

  <h1>AgriCold CAM</h1>
  <h3>Cold Storage View</h3>

  <img src="/stream">

</body>
</html>
)rawliteral";

  server.send(200, "text/html", page);
}

// ================= CAMERA STREAM =================

void handleStream() {
  WiFiClient client = server.client();

  client.println("HTTP/1.1 200 OK");
  client.println("Content-Type: multipart/x-mixed-replace; boundary=frame");
  client.println("Cache-Control: no-cache");
  client.println("Connection: close");
  client.println();

  while (client.connected()) {

    // Capture frame
    camera_fb_t *fb = esp_camera_fb_get();

    if (!fb) {
      Serial.println("Camera capture failed");
      break;
    }

    // Convert RGB565 -> JPEG
    uint8_t *jpg_buf = NULL;
    size_t jpg_len = 0;

    bool converted = frame2jpg(
      fb,
      70,
      &jpg_buf,
      &jpg_len
    );

    // Return camera framebuffer
    esp_camera_fb_return(fb);

    if (!converted) {
      Serial.println("JPEG conversion failed");
      break;
    }

    // Send JPEG frame
    client.println("--frame");
    client.println("Content-Type: image/jpeg");
    client.print("Content-Length: ");
    client.println(jpg_len);
    client.println();

    client.write(jpg_buf, jpg_len);
    client.println();

    // Free converted JPEG buffer
    free(jpg_buf);

    delay(50);
  }
}

// ================= SETUP =================

void setup() {

  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("==========================");
  Serial.println("AgriCold CAM ");
  Serial.println("==========================");

  // ==================================================
  // FLASHLIGHT
  // ESP32 Arduino Core 3.x LEDC API
  // ==================================================

  // GPIO 4 = AI Thinker ESP32-CAM flash LED
  // 5000 Hz frequency
  // 8-bit resolution
  // 128 = approximately 50% brightness

  if (ledcAttach(FLASH_GPIO_NUM, 5000, 8)) {

    ledcWrite(FLASH_GPIO_NUM, 128);

    Serial.println("Flashlight ON at 50% brightness");

  } else {

    Serial.println("Flashlight LEDC setup failed!");

  }

  // ==================================================
  // CAMERA CONFIGURATION
  // ==================================================

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

  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;

  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;

  config.xclk_freq_hz = 20000000;

  // KEEP THIS AS RGB565
  // Your camera sensor does not support JPEG output directly
  config.pixel_format = PIXFORMAT_RGB565;

  config.frame_size = FRAMESIZE_QVGA;

  config.fb_count = 1;

  // ==================================================
  // INITIALIZE CAMERA
  // ==================================================

  esp_err_t err = esp_camera_init(&config);

  if (err != ESP_OK) {

    Serial.print("Camera initialization failed: 0x");
    Serial.println(err, HEX);

    return;
  }

  Serial.println("Camera initialized successfully!");

  // ==================================================
  // CHECK SENSOR
  // ==================================================

  sensor_t *sensor = esp_camera_sensor_get();

  if (sensor != NULL) {

    Serial.print("Camera PID: 0x");
    Serial.println(sensor->id.PID, HEX);

  }

  // ==================================================
  // WIFI
  // ==================================================

  WiFi.begin(ssid, password);

  Serial.print("Connecting to WiFi");

  while (WiFi.status() != WL_CONNECTED) {

    delay(500);
    Serial.print(".");

  }

  Serial.println();
  Serial.println("WiFi connected!");

  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());

  // ==================================================
  // WEB SERVER
  // ==================================================

  server.on("/", handleRoot);

  server.on("/stream", handleStream);

  server.on("/capture", handleStream);

  server.begin();

  Serial.println("Web server started!");

  Serial.println();
  Serial.println("Open this address in your browser:");

  Serial.print("http://");
  Serial.println(WiFi.localIP());
}

// ================= LOOP =================

void loop() {

  server.handleClient();

}