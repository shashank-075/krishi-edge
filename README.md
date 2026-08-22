# 🌾 Krishi-Edge: Solar Mini Cold Storage & ESP32 Cryptographic Passport

**Krishi-Edge** is a decentralized, low-cost, and energy-efficient solar mini cold storage system designed specifically for rural and remote areas of the **North Eastern Region (NER)** of India.

It addresses post-harvest losses caused by inadequate cold storage infrastructure, unreliable electricity grids, and terrain-based transit delays by combining:
1. **Edge Condition Engine (ESP32 + DHT11 + DS3231 RTC)** with **Cryptographic SHA-256 Hash Passports** stored in LittleFS.
2. **AI-Thinker ESP32-CAM (GC2145)** live visual crop monitoring.
3. **Node.js Express Backend API Gateway & SHA-256 Ledger Verifier**.
4. **React Dashboard & Digital Twin** with OpenStreetMap deployment maps, produce freshness clocks, energy metrics, and cryptographic ledger verification.

---

## 🛠️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ESP32 HARDWARE NODES                     │
├──────────────────────────────┬──────────────────────────────┤
│  ESP32 Main Sensor Node      │   AI-Thinker ESP32-CAM       │
│  - DHT11 (Pin 4)             │   - GC2145 Camera Sensor     │
│  - DS3231 RTC (Pins 21, 22)  │   - RGB565 -> JPEG Conversion │
│  - SHA-256 Passport          │   - Port 80 WebServer        │
│  - LittleFS /condition.log   │   - GET /capture Stream      │
└──────────────┬───────────────┴──────────────┬───────────────┘
               │ HTTP / Telemetry             │ JPEG Frame Stream
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    NODE.JS EXPRESS BACKEND                  │
│                     (Port 5000 Gateway)                     │
│  - POST /api/telemetry         : Ingests ESP32 records       │
│  - GET /api/passport/verify/:id: Cryptographic chain audit  │
│  - GET /api/camera/snapshot    : ESP32-CAM HTTP Proxy       │
│  - GET /api/events             : Server-Sent Events (SSE)   │
└──────────────┬──────────────────────────────────────────────┘
               │ REST API / SSE Sync
               ▼
┌─────────────────────────────────────────────────────────────┐
│                   REACT FRONTEND DASHBOARD                  │
│                     (Port 3000 / Vite)                      │
│  - 📊 Cold-Chain Overview & Live Alerts                     │
│  - 🛡️ ESP32 Condition Passport SHA-256 Ledger Inspector     │
│  - 📷 ESP32-CAM Live Crop Inspection Stream                 │
│  - ⚡ Solar Generation & Battery Load-Shedding              │
│  - 🗺️ NER OpenStreetMap Interactive Deployment Map          │
│  - 🌾 Produce Freshness Clock & Dispatch Advisor            │
│  - 🏆 Village Co-op Economic Impact Leaderboard             │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Repository Structure

```
krishi-edge/
├── backend/
│   ├── package.json
│   ├── server.js             # Express server API endpoints & SSE broadcast
│   ├── passportEngine.js     # SHA-256 hash algorithm & chain verifier
│   └── dataStore.js          # In-memory database & sample logs
├── frontend/
│   ├── package.json
│   ├── vite.config.js        # Vite dev server + proxy to backend port 5000
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       └── KrishiEdgeApp.jsx # Full React UI dashboard
├── hardware/
│   ├── esp32_condition_passport.ino # ESP32 main sensor node firmware
│   └── esp32_cam_stream.ino         # ESP32-CAM video stream firmware
├── package.json              # Project scripts
└── README.md
```

---

## 🚀 How to Run the Project

### 1. Start the Backend Gateway
In a terminal, run:
```bash
npm run backend
```
*(Runs Node.js Express server on `http://localhost:5000`)*

### 2. Start the Frontend Dashboard
In a second terminal, run:
```bash
npm run frontend
```
*(Runs Vite React dashboard on `http://localhost:3000`)*

Open your browser at **`http://localhost:3000`**.

---

## ⚙️ ESP32 Hardware Integration Setup

1. **Flash `hardware/esp32_condition_passport.ino`**:
   - Board: ESP32 Dev Module
   - Partition Scheme: `Default 4MB with spiffs/littlefs`
   - Connect DHT11 signal pin to `GPIO 4`.
   - Connect DS3231 RTC SDA/SCL to `GPIO 21` / `GPIO 22`.

2. **Flash `hardware/esp32_cam_stream.ino`**:
   - Board: AI Thinker ESP32-CAM
   - Set Wi-Fi credentials:
     - `ssid = "Realme"`
     - `password = "okok12345"`
   - Open Serial Monitor to get the assigned IP address (e.g., `192.168.1.100`).
   - Enter this IP address in the **ESP32-CAM Live** tab of the Krishi-Edge dashboard.

---

## 🛡️ Condition Passport SHA-256 Ledger Rules

The ESP32 firmware evaluates raw DHT11 temperature readings and applies rules:
- **`LOWER_LIMIT = 2.0°C`**, **`UPPER_LIMIT = 8.0°C`**
- `temp < 2.0°C` &rarr; `FREEZE_RISK` (Action: `HOLD_VERIFY`, Confidence: 95%)
- `2.0°C <= temp <= 8.0°C` &rarr; `NORMAL` (Action: `CONTINUE`, Confidence: 95%)
- `temp > 8.0°C` (&lt; 2 minutes) &rarr; `WARNING` (Action: `VERIFY`, Confidence: 85%)
- `temp > 8.0°C` (&ge; 2 minutes) &rarr; `HOLD` (Action: `HOLD_VERIFY`, Confidence: 95%)

Every record is hashed using SHA-256:
```
currentHash = SHA256(recordNumber|timestamp|temp|humidity|state|action|confidence|previousHash)
```
and persisted to `/condition.log` on LittleFS.

The dashboard's **"ESP32 Passport"** tab connects to `/api/passport/verify/:unitId` to verify cryptographic authenticity and guarantee zero tampering across the cold chain!
