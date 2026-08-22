#include "esp_camera.h"
#include "img_converters.h"
#include <WiFi.h>
#include <WebServer.h>

// =====================================================
// WIFI
// =====================================================

const char* ssid = "Realme";
const char* password = "okok12345";

WebServer server(80);

// =====================================================
// AI-THINKER ESP32-CAM PIN MAP
// =====================================================

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

// =====================================================
// CAMERA INITIALIZATION
// GC2145 DOES NOT OUTPUT HARDWARE JPEG
// Therefore RGB565 is used.
// =====================================================

bool initCamera() {

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

  // IMPORTANT:
  // GC2145 works with RGB565, NOT hardware JPEG.
  config.pixel_format = PIXFORMAT_RGB565;

  // Keep resolution low initially for reliable conversion.
  config.frame_size = FRAMESIZE_QQVGA;

  config.jpeg_quality = 12;

  config.fb_count = 1;

  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;

  config.fb_location = CAMERA_FB_IN_DRAM;

  Serial.println("Initializing GC2145 camera...");

  esp_err_t err = esp_camera_init(&config);

  if (err != ESP_OK) {

    Serial.print("CAMERA INIT FAILED: 0x");
    Serial.println(err, HEX);

    return false;
  }

  sensor_t* sensor = esp_camera_sensor_get();

  if (sensor == NULL) {

    Serial.println("SENSOR NOT FOUND!");

    return false;
  }

  Serial.print("Sensor PID: 0x");
  Serial.println(sensor->id.PID, HEX);

  Serial.println("GC2145 CAMERA INIT OK!");

  return true;
}

// =====================================================
// WEB PAGE
// =====================================================

void handleRoot() {

  String page = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TVCE Camera</title>

<style>

body {
  background: #111;
  color: white;
  font-family: Arial;
  text-align: center;
  margin: 0;
  padding: 20px;
}

h1 {
  margin-bottom: 10px;
}

img {
  width: 100%;
  max-width: 640px;
  height: auto;
  border: 2px solid white;
}

.status {
  margin-top: 15px;
  font-size: 18px;
}

</style>
</head>

<body>

<h1>TVCE ESP32-CAM</h1>

<div class="status">
Live Camera
</div>

<img id="cam" src="/capture">

<script>

setInterval(function() {

  document.getElementById("cam").src =
    "/capture?t=" + new Date().getTime();

}, 300);

</script>

</body>
</html>
)rawliteral";

  server.send(200, "text/html", page);
}

// =====================================================
// CAPTURE + RGB565 → JPEG CONVERSION
// =====================================================

void handleCapture() {

  camera_fb_t* fb = esp_camera_fb_get();

  if (!fb) {

    Serial.println("FRAME CAPTURE FAILED");

    server.send(
      500,
      "text/plain",
      "Camera capture failed"
    );

    return;
  }

  uint8_t* jpg_buf = NULL;
  size_t jpg_len = 0;

  bool converted = frame2jpg(
    fb,
    60,
    &jpg_buf,
    &jpg_len
  );

  if (!converted) {

    Serial.println("JPEG CONVERSION FAILED");

    esp_camera_fb_return(fb);

    server.send(
      500,
      "text/plain",
      "JPEG conversion failed"
    );

    return;
  }

  server.sendHeader(
    "Cache-Control",
    "no-cache, no-store, must-revalidate"
  );

  server.sendHeader(
    "Pragma",
    "no-cache"
  );

  server.sendHeader(
    "Expires",
    "0"
  );

  server.setContentLength(jpg_len);

  server.send(
    200,
    "image/jpeg",
    ""
  );

  WiFiClient client = server.client();

  client.write(
    jpg_buf,
    jpg_len
  );

  free(jpg_buf);

  esp_camera_fb_return(fb);

  Serial.print("JPEG frame sent: ");
  Serial.print(jpg_len);
  Serial.println(" bytes");
}

// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(115200);

  delay(2000);

  Serial.println();
  Serial.println("==============================");
  Serial.println("     TVCE ESP32-CAM");
  Serial.println("==============================");

  // Camera

  if (!initCamera()) {

    Serial.println("CAMERA FAILED!");

    while (true) {
      delay(1000);
    }
  }

  // WiFi

  Serial.println();
  Serial.print("Connecting to WiFi");

  WiFi.begin(
    ssid,
    password
  );

  while (WiFi.status() != WL_CONNECTED) {

    delay(500);

    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi connected!");

  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  // Web server

  server.on(
    "/",
    HTTP_GET,
    handleRoot
  );

  server.on(
    "/capture",
    HTTP_GET,
    handleCapture
  );

  server.begin();

  Serial.println("Web server started!");

  Serial.println();
  Serial.println("==============================");
  Serial.print("OPEN: http://");
  Serial.print(WiFi.localIP());
  Serial.println("/");
  Serial.println("==============================");
}

// =====================================================
// LOOP
// =====================================================

void loop() {

  server.handleClient();

  delay(1);
}
