# Krishi-Edge: Solar Mini Cold Storage & Cryptographic Produce Passport

Krishi-Edge is a decentralized, off-grid solar mini cold storage platform designed to eliminate post-harvest agricultural losses in remote, rural, and mountainous terrains such as the North Eastern Region (NER) of India.

The platform integrates edge sensing, local machine learning computer vision, tamper-evident cryptographic data logging, and an interactive digital twin dashboard to ensure reliable cold-chain accountability from farm harvest to regional dispatch.

---

## Key Features

- **Edge Condition Engine**: ESP32 microcontroller with DHT11 temperature/humidity sensing, high-precision DS3231 RTC timekeeping, and on-board SSD1306 OLED diagnostics.
- **Cryptographic Produce Passport**: Continuous SHA-256 hash-chained telemetry records persisted to LittleFS flash memory, guaranteeing immutable audit trails and tamper detection across transit.
- **On-Device & Service-Based Computer Vision**: MobileNetV2-based edge classification for visual crop freshness evaluation (apple, banana, orange) deployed on ESP32-CAM and supported by a FastAPI inference microservice.
- **Flexible Data Uplink**: Dual-mode ingestion supporting direct USB Serial COM port streaming (for offline/tethered setups) and HTTP/REST telemetry with Server-Sent Events (SSE) synchronization.
- **Multi-Channel Alert System**: Automated excursion notifications dispatched via Telegram Bot, HTTP Webhooks, and SMS whenever storage limits are breached.
- **Interactive Web Dashboard**: React-based operator interface providing cold-chain status, cryptographic verification audits, live MJPEG video streams, solar battery load management, and an interactive NER geographic deployment map.

---

## System Architecture

```
+-------------------------------------------------------------------------+
|                           EDGE HARDWARE TIER                            |
+------------------------------------+------------------------------------+
|  ESP32 Main Sensor Node            |  AI-Thinker ESP32-CAM Node         |
|  - DHT11 Temperature & Humidity    |  - GC2145 / OV2640 Image Sensor    |
|  - DS3231 Precision I2C RTC        |  - MJPEG Frame Streamer (Port 80)  |
|  - SSD1306 128x64 I2C OLED Display |  - On-Device TFLite INT8 Inference |
|  - SHA-256 Passport Engine         |  - MQTT Freshness Publisher        |
|  - LittleFS /condition.log         |                                    |
+------------------------------------+------------------------------------+
                  |                                    |
     USB Serial / HTTP Telemetry                MJPEG / MQTT Stream
                  |                                    |
                  v                                    v
+-------------------------------------------------------------------------+
|                           GATEWAY & ML TIER                             |
+-------------------------------------------------------------------------+
|  Node.js / Express Telemetry Gateway (Port 5000, 0.0.0.0)               |
|  - Ingestion: POST /api/telemetry, USB Serial Bridge (serialport)       |
|  - Cryptographic Audit: SHA-256 Chain Verification Engine               |
|  - Database: MongoDB with automatic in-memory fallback                  |
|  - Real-time Events: Server-Sent Events (SSE) push stream               |
|  - Camera Proxy: HTTP MJPEG stream pipe & frame buffer                  |
|  - Alert Dispatcher: Telegram Bot, Webhook, SMS notification engine     |
+-------------------------------------------------------------------------+
|  FastAPI ML Inference Microservice (Port 8000)                          |
|  - MobileNetV2 Classifier (INT8 Quantized / Float32 fallback)           |
|  - Endpoints: /health, /predict, /predict/camera                        |
+-------------------------------------------------------------------------+
                                    |
                          REST API / SSE Events
                                    |
                                    v
+-------------------------------------------------------------------------+
|                         OPERATOR DASHBOARD TIER                         |
+-------------------------------------------------------------------------+
|  React 18 + Vite Web Application (Port 3000)                            |
|  - Dashboard: System status, temperature trends, battery metrics        |
|  - ESP32 Passport: SHA-256 ledger viewer & chain integrity verifier     |
|  - ESP32-CAM Live: Real-time chamber video inspection & flash control   |
|  - Produce & Dispatch: Shelf-life projection & dynamic dispatch advisor |
|  - Digital Twin: Chamber thermodynamic model & subsystem schematic      |
|  - Energy & Solar: MPPT efficiency, battery state of charge, loads      |
|  - NER Deployment Map: Leaflet-powered unit distribution across NER     |
|  - Cooperative Impact: Economic savings, loss reduction & carbon credit |
+-------------------------------------------------------------------------+
```

---

## Repository Structure

```
krishi-edge/
├── backend/
│   ├── .env                       # Environment configuration (PORT, MONGO_URI, ML URL)
│   ├── alertNotifier.js           # Multi-channel notification dispatcher (Telegram, Webhook, SMS)
│   ├── dataStore.js               # Dual-mode data persistence (MongoDB + In-memory fallback)
│   ├── db.js                      # MongoDB connection manager
│   ├── mlClient.js                # Integration client for FastAPI ML intelligence service
│   ├── mlFreshnessEngine.js       # Freshness score calculations and rules
│   ├── package.json               # Backend Node.js dependencies and scripts
│   ├── passportEngine.js          # Cryptographic SHA-256 ledger and condition state rules
│   ├── serialBridge.js            # USB COM port auto-discovery and serial data parser
│   └── server.js                  # Express API gateway, camera proxy, and SSE broadcaster
├── frontend/
│   ├── index.html                 # Main application HTML entry point
│   ├── package.json               # Frontend React/Vite dependencies
│   ├── vite.config.js             # Vite development server and backend proxy configuration
│   └── src/
│       ├── KrishiEdgeApp.jsx      # Comprehensive React dashboard and digital twin
│       └── main.jsx               # React DOM entry point
├── hardware/
│   ├── esp32_condition_passport.ino # Firmware: ESP32 condition engine, RTC, SHA-256, LittleFS
│   ├── esp32_cam_mjpeg_stream/     # Firmware: ESP32-CAM MJPEG server with flash control
│   ├── esp32_cam_stream/           # Firmware: ESP32-CAM basic frame capture server
│   └── esp32_main_sensor_oled/     # Firmware: ESP32 sensor node with SSD1306 I2C OLED display
├── ml_model/
│   ├── convert_to_c_array.py      # Converts quantized TFLite model to C header (model_data.h)
│   ├── esp32cam_inference.ino     # Firmware: On-device TFLite Micro inference over MQTT
│   ├── mqtt_bridge.py             # MQTT subscriber bridge routing visual scores to storage
│   ├── prepare_dataset.py         # Dataset processor for fruit freshness image classes
│   ├── README.md                  # ML pipeline detailed documentation
│   ├── requirements.txt           # Python dependencies for training and conversion
│   ├── serve_model.py             # FastAPI inference microservice for fruit freshness
│   └── train_model.py             # Transfer learning and INT8 post-training quantization
├── package.json                   # Root workspace management scripts
└── README.md                      # Project documentation
```

---

## Hardware Specifications & Pinout

### 1. ESP32 Main Sensor Node

| Component | ESP32 GPIO Pin | Protocol / Description |
| :--- | :--- | :--- |
| DHT11 Data Pin | GPIO 4 | Digital One-Wire bus |
| DS3231 RTC SDA | GPIO 21 | I2C Data line (0x68) |
| DS3231 RTC SCL | GPIO 22 | I2C Clock line |
| SSD1306 OLED SDA | GPIO 21 | Shared I2C Data line (0x3C) |
| SSD1306 OLED SCL | GPIO 22 | Shared I2C Clock line |
| Power Supply | 5V / VIN & GND | USB or regulated 5V step-down |

### 2. AI-Thinker ESP32-CAM Module

| Function / Signal | Pin Definition | Notes |
| :--- | :--- | :--- |
| Camera Power Down (PWDN) | GPIO 32 | Power control |
| Camera Reset | GPIO -1 | Software reset |
| Camera XCLK | GPIO 0 | Master clock input |
| On-board Flash LED | GPIO 4 | High-power illumination LED |
| Camera Data Lines | GPIO 35, 34, 39, 36, 21, 19, 18, 5 | Y9 through Y2 parallel bus |
| Camera Clock Lines | GPIO 25 (VSYNC), 23 (HREF), 22 (PCLK) | Sync and pixel clock |
| Serial Programming | U0TXD (GPIO 1), U0RXD (GPIO 3), GPIO 0 to GND | Ground GPIO 0 during boot to flash |

### 3. Energy & Cooling Hardware

- **Solar Array**: 40W monocrystalline solar panel, tilt-adjustable.
- **Charge Controller**: 12V 10A MPPT controller with low-voltage disconnect.
- **Battery System**: 12V 20Ah LiFePO4 pack or 3S 18650 Li-ion storage array.
- **Chamber Cooling**: Variable-speed 12V DC compressor / TEC Peltier refrigeration block inside a 3L PUF-insulated rotomoulded chamber.

---

## Cryptographic Produce Passport

To establish non-repudiation and prevent fraud across cold-chain handoffs, every sensor reading is hashed sequentially using SHA-256.

### Record Construction

Each record consists of the following fields:

```
Payload = recordNumber | timestamp | temperature | humidity | state | action | confidence | previousHash
```

The current block hash is computed as:

```
currentHash = SHA-256(Payload)
```

- **Genesis Record**: Uses a 64-character zero string (`0000...0000`) as `previousHash`.
- **Subsequent Records**: Must reference the exact `currentHash` of the immediately preceding record.
- **Integrity Validation**: If any historical temperature record or timestamp is modified, all downstream hashes in the ledger fail validation.

### Condition Evaluation Rules

| Temperature Range | Condition State | Dispatch Action | Confidence | Excursion Rule |
| :--- | :--- | :--- | :--- | :--- |
| `< 2.0°C` | `FREEZE_RISK` | `HOLD_VERIFY` | 95% | Immediate flag |
| `2.0°C - 8.0°C` | `NORMAL` | `CONTINUE` | 95% | Nominal safe cold-chain band |
| `> 8.0°C` | `WARNING` | `VERIFY` | 85% | Active excursion under 2 minutes |
| `> 8.0°C` | `HOLD` | `HOLD_VERIFY` | 95% | Sustained excursion 2 minutes or longer |

---

## Machine Learning Vision Pipeline

The `ml_model/` subsystem runs vision-based freshness assessment on 6 produce categories:
- Fresh Apple, Rotten Apple
- Fresh Banana, Rotten Banana
- Fresh Orange, Rotten Orange

### Pipeline Stages

1. **Dataset Preparation**: `prepare_dataset.py` formats Kaggle produce freshness datasets into train and validation subsets.
2. **Model Training**: `train_model.py` uses MobileNetV2 (`alpha=0.35`) with transfer learning, followed by INT8 post-training quantization to satisfy the ESP32-CAM memory footprint.
3. **Firmware Export**: `convert_to_c_array.py` creates `model_data.h` containing the quantized model as a static C byte array.
4. **On-Device Execution**: `esp32cam_inference.ino` runs TensorFlow Lite for Microcontrollers, wakes periodically from deep sleep, performs inference, publishes results via MQTT, and returns to low-power sleep.
5. **Inference Microservice**: `serve_model.py` provides an HTTP FastAPI alternative for centralized inference over local network camera streams.

---

## Installation & Setup

### Prerequisites

- **Node.js**: v18.x or later and npm
- **Python**: v3.9+ (optional, for ML service and training scripts)
- **Arduino IDE / ESP-IDF**: With ESP32 board support installed
- **MongoDB**: Optional (runs in in-memory fallback mode if MongoDB is absent)

### 1. Install Node.js Dependencies

From the repository root:

```bash
npm run install:all
```

Or install backend and frontend dependencies manually:

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Environment Configuration

Inspect or update `backend/.env`:

```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/krishi-edge
ML_SERVICE_URL=http://127.0.0.1:8000
```

### 3. Start the Backend API Gateway

```bash
npm run backend
```

The Express API gateway starts on `http://0.0.0.0:5000`.

### 4. Start the Frontend Dashboard

In a separate terminal:

```bash
npm run frontend
```

The Vite development server will open on `http://localhost:3000`.

### 5. Start the ML Service (Optional)

In a third terminal:

```bash
cd ml_model
pip install -r requirements.txt
python serve_model.py
```

The FastAPI service will listen on `http://0.0.0.0:8000`.

---

## API Reference

### Telemetry & Ingestion

- **`GET /api/telemetry`**: Retrieves the most recent telemetry reading cached in memory.
- **`POST /api/telemetry`**: Ingests new telemetry from edge devices or gateway scripts.
  ```json
  {
    "unitId": "CS-101",
    "temperature": 4.2,
    "humidity": 85.0,
    "state": "NORMAL",
    "action": "CONTINUE",
    "confidence": 95,
    "recordNumber": 12,
    "previousHash": "...",
    "currentHash": "..."
  }
  ```
- **`GET /api/events`**: Server-Sent Events (SSE) stream for real-time dashboard data broadcasts.

### Cryptographic Passport

- **`GET /api/passport/:unitId`**: Fetches all logged condition passport records for the specified unit.
- **`GET /api/passport/verify/:unitId`**: Computes sequential SHA-256 verification and returns full chain integrity report.

### Storage Units & Diagnostics

- **`GET /api/units`**: Lists all registered cold storage units, including current sensor readings and latest ML predictions.
- **`GET /api/units/:id`**: Returns detailed status, configuration, and recent records for a single unit.
- **`POST /api/simulate/telemetry`**: Injects simulated readings for unit testing without attached hardware.

### Hardware Bridges & Notifications

- **`GET /api/serial/ports`**: Lists detected USB serial COM ports on the host system.
- **`POST /api/serial/connect`**: Connects the gateway to a specified COM port (`path`, `baudRate`).
- **`POST /api/serial/disconnect`**: Disconnects the active serial port.
- **`GET /api/notifications/settings`**: Returns current alert dispatch configuration.
- **`POST /api/notifications/settings`**: Updates credentials and toggles for Telegram, Webhook, and SMS alerts.
- **`POST /api/notifications/test`**: Dispatches a test alert across all enabled channels.

### Camera & Video Stream

- **`GET /api/camera/stream?ip=<IP>`**: Proxies live MJPEG video stream from an ESP32-CAM module.
- **`GET /api/camera/snapshot?ip=<IP>`**: Returns a single JPEG snapshot or SVG fallback card.

### Machine Learning Service

- **`GET /api/ml/health`**: Verifies connectivity with the FastAPI inference microservice.
- **`POST /api/ml/predict`**: Computes spoilage risk based on unit telemetry features.
- **`POST /api/ml/simulate`**: Runs scenario simulations (`normal`, `outage`, `warning`).

---

## Flashing ESP32 Firmware

1. Install the ESP32 Board Core in the Arduino IDE (`https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`).
2. Install required Arduino libraries:
   - `DHT sensor library` by Adafruit
   - `RTClib` by Adafruit
   - `Adafruit SSD1306` and `Adafruit GFX Library`
3. Open `hardware/esp32_condition_passport.ino` or `hardware/esp32_main_sensor_oled/esp32_main_sensor_oled.ino`.
4. Select `ESP32 Dev Module`, choose partition scheme `Default 4MB with spiffs/littlefs`, and select your USB COM port.
5. Compile and upload to the board.
6. For ESP32-CAM: Open `hardware/esp32_cam_mjpeg_stream/esp32_cam_mjpeg_stream.ino`, select `AI Thinker ESP32-CAM`, configure your local Wi-Fi credentials, and flash.

---

## License

This project is licensed under the MIT License. See [package.json](file:///c:/Users/shash/Projects/krishi-edge/package.json) for additional metadata.
