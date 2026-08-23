#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "DHT.h"

// DHT11
#define DHTPIN 4
#define DHTTYPE DHT11

DHT dht(DHTPIN, DHTTYPE);

// OLED
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define OLED_ADDR 0x3C

Adafruit_SSD1306 display(
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  &Wire,
  OLED_RESET
);

void setup() {

  Serial.begin(115200);

  dht.begin();

  // OLED I2C
  Wire.begin(21, 22);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("OLED NOT FOUND");
    while (1);
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(1);
  display.setCursor(18, 0);
  display.println("SMART COLD STORE");

  display.display();

  delay(1500);
}

void loop() {

  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();

  if (isnan(temperature) || isnan(humidity)) {

    Serial.println("DHT ERROR");

    display.clearDisplay();

    display.setTextSize(1);
    display.setCursor(20, 25);
    display.println("DHT SENSOR ERROR");

    display.display();

    delay(2000);
    return;
  }

  // Status logic
  String status;

  if (temperature > 30) {
    status = "WARNING";
  } 
  else {
    status = "NORMAL";
  }

  // Serial Monitor
  Serial.print("Temperature: ");
  Serial.print(temperature);
  Serial.print(" C | Humidity: ");
  Serial.print(humidity);
  Serial.print(" % | Status: ");
  Serial.println(status);


  // OLED
  display.clearDisplay();

  display.setTextColor(SSD1306_WHITE);

  // Title
  display.setTextSize(1);
  display.setCursor(18, 0);
  display.println("SMART COLD STORE");

  // Temperature
  display.setTextSize(2);
  display.setCursor(0, 17);
  display.print("T:");
  display.print(temperature, 1);
  display.println(" C");

  // Humidity
  display.setCursor(0, 37);
  display.print("H:");
  display.print(humidity, 0);
  display.println("%");

  // Status
  display.setTextSize(1);
  display.setCursor(0, 56);
  display.print("STATUS: ");
  display.print(status);

  display.display();

  delay(2000);
}
