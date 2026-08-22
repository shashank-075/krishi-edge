#include <Wire.h>
#include <RTClib.h>
#include "DHT.h"
#include <LittleFS.h>
#include <mbedtls/sha256.h>

#define DHTPIN 4
#define DHTTYPE DHT11

DHT dht(DHTPIN, DHTTYPE);
RTC_DS3231 rtc;

const float LOWER_LIMIT = 2.0;
const float UPPER_LIMIT = 8.0;

const unsigned long WARNING_DURATION = 2UL * 60UL * 1000UL;

unsigned long excursionStart = 0;
bool excursionActive = false;

unsigned long recordNumber = 0;

String previousHash =
  "0000000000000000000000000000000000000000000000000000000000000000";


// =====================================================
// SHA-256
// =====================================================

String calculateSHA256(String data) {

  unsigned char hash[32];

  mbedtls_sha256_context ctx;

  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts(&ctx, 0);

  mbedtls_sha256_update(
    &ctx,
    (const unsigned char*)data.c_str(),
    data.length()
  );

  mbedtls_sha256_finish(&ctx, hash);
  mbedtls_sha256_free(&ctx);

  String result = "";

  for (int i = 0; i < 32; i++) {
    if (hash[i] < 16) {
      result += "0";
    }
    result += String(hash[i], HEX);
  }

  result.toUpperCase();

  return result;
}


// =====================================================
// RECOVER PREVIOUS STATE
// =====================================================

void loadState() {

  if (!LittleFS.exists("/state.txt")) {

    Serial.println("No previous state.");
    Serial.println("Starting new passport.");

    recordNumber = 0;

    previousHash =
      "0000000000000000000000000000000000000000000000000000000000000000";

    return;
  }

  File file = LittleFS.open("/state.txt", "r");

  if (!file) {
    Serial.println("STATE READ FAILED!");
    return;
  }

  String numberLine = file.readStringUntil('\n');
  String hashLine = file.readStringUntil('\n');

  file.close();

  recordNumber = numberLine.toInt();

  hashLine.trim();

  if (hashLine.length() == 64) {
    previousHash = hashLine;
  }

  Serial.println("Previous state recovered.");

  Serial.print("LAST RECORD : ");
  Serial.println(recordNumber);

  Serial.print("LAST HASH   : ");
  Serial.println(previousHash);
}


// =====================================================
// SAVE STATE
// =====================================================

void saveState() {

  File file = LittleFS.open("/state.txt", "w");

  if (!file) {
    Serial.println("STATE WRITE FAILED!");
    return;
  }

  file.println(recordNumber);
  file.println(previousHash);

  file.flush();
  file.close();
}


// =====================================================
// SAVE CONDITION RECORD
// =====================================================

void saveRecord(
  String timestamp,
  float temperature,
  float humidity,
  String state,
  String action,
  int confidence,
  String currentHash
) {

  File file = LittleFS.open("/condition.log", "a");

  if (!file) {
    Serial.println("LOG WRITE FAILED!");
    return;
  }

  file.print(recordNumber);
  file.print("|");

  file.print(timestamp);
  file.print("|");

  file.print(temperature, 1);
  file.print("|");

  file.print(humidity, 1);
  file.print("|");

  file.print(state);
  file.print("|");

  file.print(action);
  file.print("|");

  file.print(confidence);
  file.print("|");

  file.print(previousHash);
  file.print("|");

  file.println(currentHash);

  file.flush();
  file.close();
}


// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(115200);
  delay(1500);

  Wire.begin(21, 22);

  dht.begin();

  if (!rtc.begin()) {

    Serial.println("DS3231 NOT FOUND!");

    while (1);
  }


  // LittleFS
  if (!LittleFS.begin(false)) {

    Serial.println("LITTLEFS MOUNT FAILED!");

    Serial.println("Use the LittleFS format test first.");

    while (1);
  }


  Serial.println();
  Serial.println("==========================================");
  Serial.println("   TVCE PERSISTENT CONDITION PASSPORT");
  Serial.println("==========================================");

  loadState();

  Serial.println("------------------------------------------");
}


// =====================================================
// LOOP
// =====================================================

void loop() {

  DateTime now = rtc.now();

  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();

  if (isnan(temperature) || isnan(humidity)) {

    Serial.println("DHT11 READ FAILED!");

    delay(2000);
    return;
  }


  // ===================================================
  // CONDITION ENGINE
  // ===================================================

  String state;
  String action;
  int confidence;


  if (temperature < LOWER_LIMIT) {

    state = "FREEZE_RISK";
    action = "HOLD_VERIFY";
    confidence = 95;

    excursionActive = false;
  }


  else if (temperature >= LOWER_LIMIT &&
           temperature <= UPPER_LIMIT) {

    state = "NORMAL";
    action = "CONTINUE";
    confidence = 95;

    excursionActive = false;
  }


  else {

    if (!excursionActive) {

      excursionActive = true;
      excursionStart = millis();
    }

    unsigned long duration =
      millis() - excursionStart;


    if (duration < WARNING_DURATION) {

      state = "WARNING";
      action = "VERIFY";
      confidence = 85;

    } else {

      state = "HOLD";
      action = "HOLD_VERIFY";
      confidence = 95;
    }
  }


  // ===================================================
  // TIMESTAMP
  // ===================================================

  char timestamp[25];

  sprintf(
    timestamp,
    "%04d-%02d-%02d %02d:%02d:%02d",
    now.year(),
    now.month(),
    now.day(),
    now.hour(),
    now.minute(),
    now.second()
  );


  // ===================================================
  // RECORD
  // ===================================================

  recordNumber++;

  String record =
    String(recordNumber) +
    "|" +
    String(timestamp) +
    "|" +
    String(temperature, 1) +
    "|" +
    String(humidity, 1) +
    "|" +
    state +
    "|" +
    action +
    "|" +
    String(confidence) +
    "|" +
    previousHash;


  // ===================================================
  // HASH
  // ===================================================

  String currentHash =
    calculateSHA256(record);


  // ===================================================
  // DISPLAY
  // ===================================================

  Serial.println();

  Serial.println("----------- CONDITION RECORD -----------");

  Serial.print("RECORD #       : ");
  Serial.println(recordNumber);

  Serial.print("TIME           : ");
  Serial.println(timestamp);

  Serial.print("TEMP           : ");
  Serial.print(temperature, 1);
  Serial.println(" C");

  Serial.print("HUMIDITY       : ");
  Serial.print(humidity, 1);
  Serial.println(" %");

  Serial.print("STATE          : ");
  Serial.println(state);

  Serial.print("CONFIDENCE     : ");
  Serial.print(confidence);
  Serial.println("%");

  Serial.print("ACTION         : ");
  Serial.println(action);

  Serial.print("PREVIOUS HASH  : ");
  Serial.println(previousHash);

  Serial.print("CURRENT HASH   : ");
  Serial.println(currentHash);


  // ===================================================
  // PERSIST
  // ===================================================

  previousHash = currentHash;

  saveRecord(
    timestamp,
    temperature,
    humidity,
    state,
    action,
    confidence,
    currentHash
  );

  saveState();

  Serial.println("LITTLEFS      : SAVED");

  Serial.println("----------------------------------------");

  delay(5000);
}
