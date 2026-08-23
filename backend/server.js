const express = require("express");
const cors = require("cors");
const http = require("http");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const { connectDB, getIsConnected } = require("./db");
const { getUnits, getUnitById, getPassportLogs, appendPassportRecord } = require("./dataStore");
const { verifyPassportChain, calculateSHA256 } = require("./passportEngine");
const { listSerialPorts, connectSerialPort, disconnectSerialPort, getSerialStatus, setBroadcastFunction } = require("./serialBridge");
const { dispatchAlertNotification, getSettings, updateSettings, getNotificationHistory } = require("./alertNotifier");
const { recordSensorReading, computeDerivedFeatures, checkMLServiceHealth, predictForUnit, getLatestPrediction, ML_SERVICE_URL } = require("./mlClient");

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

// Enable CORS for all incoming cross-origin requests from LAN / dashboard
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize MongoDB Connection (with graceful memory fallback)
connectDB();

// Store connected Server-Sent Events (SSE) clients for real-time dashboard pushes
let sseClients = [];

function broadcastEvent(eventType, data) {
  sseClients.forEach((client) => {
    client.res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  });
}

// Pass broadcast function to Serial Bridge
setBroadcastFunction(broadcastEvent);

// Latest AGRICOLD telemetry cache in memory
let latestTelemetry = {
  temperature: 26.8,
  humidity: 73.2,
  state: "NORMAL",
  action: "CONTINUE",
  confidence: 95,
  record: 1,
  unitId: "CS-101",
  timestamp: new Date().toISOString()
};

// =====================================================
// API HEALTH & ML SERVICE STATUS
// =====================================================
app.get("/api/health", async (req, res) => {
  const mlHealth = await checkMLServiceHealth();
  res.json({
    status: "online",
    system: "AGRICOLD Telemetry Gateway",
    database: getIsConnected() ? "MongoDB (Active)" : "In-Memory Mode",
    serialBridge: getSerialStatus(),
    mlService: {
      url: ML_SERVICE_URL,
      ...mlHealth
    },
    timestamp: new Date().toISOString(),
    connectedClients: sseClients.length,
  });
});

// =====================================================
// AGRICOLD TELEMETRY ENDPOINTS
// =====================================================

// GET /api/telemetry - Returns latest AGRICOLD telemetry record
app.get("/api/telemetry", (req, res) => {
  res.json(latestTelemetry);
});

// POST /api/telemetry - Receives telemetry from AGRICOLD Python Gateway
app.post("/api/telemetry", async (req, res) => {
  const {
    unitId = "CS-101",
    temperature,
    humidity,
    state,
    action,
    confidence,
    record: rawRecord,
    recordNumber,
    timestamp,
    previousHash,
    currentHash,
    power,
    ...extraHardwareData
  } = req.body;

  // Validate payload
  const tempNum = Number(temperature);
  const humNum = Number(humidity);

  if (temperature === undefined || humidity === undefined || isNaN(tempNum) || isNaN(humNum)) {
    return res.status(400).json({
      success: false,
      error: "Malformed telemetry payload. 'temperature' and 'humidity' must be numeric."
    });
  }

  const recNum = Number(rawRecord !== undefined ? rawRecord : (recordNumber !== undefined ? recordNumber : Date.now()));
  const confNum = Number(confidence !== undefined ? confidence : 95);
  const stateStr = String(state || (tempNum > 30.0 ? "WARNING" : "NORMAL"));
  const actionStr = String(action || (stateStr === "WARNING" ? "VERIFY" : "CONTINUE"));

  // Update rolling history for ML feature computation
  recordSensorReading(unitId, { temperature: tempNum, humidity: humNum, power });

  const recordData = await appendPassportRecord(unitId, {
    recordNumber: recNum,
    timestamp,
    temperature: tempNum,
    humidity: humNum,
    state: stateStr,
    action: actionStr,
    confidence: confNum,
    previousHash,
    currentHash,
    ...extraHardwareData
  });

  const computedHash = calculateSHA256(recordData);
  const isValidHash = computedHash === recordData.currentHash;

  latestTelemetry = {
    temperature: tempNum,
    humidity: humNum,
    state: stateStr,
    action: actionStr,
    confidence: confNum,
    record: recNum,
    unitId,
    timestamp: recordData.timestamp || new Date().toISOString()
  };

  if (stateStr === "WARNING" || stateStr === "HOLD" || stateStr === "FREEZE_RISK") {
    dispatchAlertNotification({
      sev: stateStr === "WARNING" ? "Warning" : "Critical",
      title: `Condition Event: ${stateStr} at ${unitId}`,
      sub: `Temperature ${tempNum.toFixed(1)}°C · Humidity ${humNum.toFixed(1)}% RH`,
      unitId,
    });
  }

  // Trigger ML prediction update asynchronously
  predictForUnit(unitId).then((mlPrediction) => {
    broadcastEvent("ml_prediction", mlPrediction);
  }).catch((e) => console.warn(e));

  // Push real-time telemetry update to connected React dashboard clients
  broadcastEvent("telemetry", { unitId, record: recordData, isValidHash, latestTelemetry });

  res.status(200).json({
    success: true,
    message: "Telemetry received",
    unitId,
    record: latestTelemetry,
    isValidHash,
  });
});

// =====================================================
// FASTAPI ML STORAGE INTELLIGENCE ENDPOINTS (http://172.21.42.90:8000)
// =====================================================
app.get("/api/ml/health", async (req, res) => {
  const health = await checkMLServiceHealth();
  res.json(health);
});

app.get("/api/ml/predict/:unitId?", async (req, res) => {
  const unitId = req.params.unitId || "CS-101";
  const prediction = getLatestPrediction(unitId) || await predictForUnit(unitId);
  res.json(prediction);
});

app.post("/api/ml/predict", async (req, res) => {
  const { unitId = "CS-101", customFeatures } = req.body;
  const prediction = await predictForUnit(unitId, customFeatures || req.body);
  broadcastEvent("ml_prediction", prediction);
  res.json(prediction);
});

app.post("/api/ml/simulate", async (req, res) => {
  const { unitId = "CS-101", scenario = "normal" } = req.body;

  let demoFeatures;

  if (scenario === "outage") {
    demoFeatures = {
      produce_type: "tomato",
      storage_hours: 48,
      avg_temperature: 12.4,
      max_temperature: 16.8,
      min_temperature: 7.8,
      temperature_std: 3.1,
      time_above_10c: 8.5,
      time_above_12c: 4.2,
      avg_humidity: 92,
      max_humidity: 97,
      humidity_std: 3.8,
      time_above_90rh: 12.0,
      time_above_95rh: 4.5,
      power_outages: 3,
      total_outage_hours: 5.2,
      longest_outage_hours: 3.5,
      temperature_recovery_minutes: 85
    };
  } else if (scenario === "warning") {
    demoFeatures = {
      produce_type: "capsicum",
      storage_hours: 72,
      avg_temperature: 14.2,
      max_temperature: 18.5,
      min_temperature: 9.0,
      temperature_std: 4.2,
      time_above_10c: 18.0,
      time_above_12c: 12.5,
      avg_humidity: 94,
      max_humidity: 98,
      humidity_std: 4.1,
      time_above_90rh: 24.0,
      time_above_95rh: 10.0,
      power_outages: 4,
      total_outage_hours: 8.0,
      longest_outage_hours: 4.5,
      temperature_recovery_minutes: 120
    };
  } else {
    // Normal storage scenario
    demoFeatures = {
      produce_type: "tomato",
      storage_hours: 48,
      avg_temperature: 4.5,
      max_temperature: 7.2,
      min_temperature: 3.8,
      temperature_std: 0.8,
      time_above_10c: 0.0,
      time_above_12c: 0.0,
      avg_humidity: 86,
      max_humidity: 90,
      humidity_std: 1.5,
      power_outages: 0,
      total_outage_hours: 0.0,
      longest_outage_hours: 0.0,
      temperature_recovery_minutes: 0
    };
  }

  const prediction = await predictForUnit(unitId, demoFeatures);
  broadcastEvent("ml_prediction", prediction);

  res.json({
    message: `Simulated ML prediction calculated for scenario: ${scenario}`,
    scenario,
    prediction
  });
});

// =====================================================
// UNITS ENDPOINTS
// =====================================================
app.get("/api/units", async (req, res) => {
  const units = await getUnits();
  const merged = units.map((u) => {
    const ml = getLatestPrediction(u.id);
    return {
      ...u,
      mlPrediction: ml || null
    };
  });
  res.json(merged);
});

app.get("/api/units/:id", async (req, res) => {
  const unit = await getUnitById(req.params.id);
  if (!unit) {
    return res.status(404).json({ error: "Unit not found" });
  }
  const passport = await getPassportLogs(unit.id);
  const ml = getLatestPrediction(unit.id) || await predictForUnit(unit.id);

  res.json({
    ...unit,
    mlPrediction: ml,
    passportCount: passport.length,
    latestPassport: passport[passport.length - 1] || null
  });
});

// =====================================================
// CONDITION PASSPORT & HASH CHAIN ENDPOINTS
// =====================================================
app.get("/api/passport/:unitId", async (req, res) => {
  const { unitId } = req.params;
  const logs = await getPassportLogs(unitId);
  res.json({
    unitId,
    totalRecords: logs.length,
    records: logs,
  });
});

app.get("/api/passport/verify/:unitId", async (req, res) => {
  const { unitId } = req.params;
  const logs = await getPassportLogs(unitId);
  const report = verifyPassportChain(logs);
  res.json({
    unitId,
    timestamp: new Date().toISOString(),
    ...report,
  });
});

// =====================================================
// USB SERIAL COM PORT BRIDGE ENDPOINTS
// =====================================================
app.get("/api/serial/ports", async (req, res) => {
  const ports = await listSerialPorts();
  const status = getSerialStatus();
  res.json({ status, ports });
});

app.post("/api/serial/connect", async (req, res) => {
  const { path, baudRate = 115200 } = req.body;
  if (!path) return res.status(400).json({ error: "COM port path is required (e.g. COM3)" });

  try {
    const result = await connectSerialPort(path, baudRate);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/serial/disconnect", async (req, res) => {
  const result = await disconnectSerialPort();
  res.json(result);
});

// =====================================================
// TELEGRAM / WEBHOOK / SMS NOTIFICATIONS
// =====================================================
app.get("/api/notifications/settings", (req, res) => {
  res.json(getSettings());
});

app.post("/api/notifications/settings", (req, res) => {
  const updated = updateSettings(req.body);
  res.json({ message: "Notification settings updated", settings: updated });
});

app.get("/api/notifications/history", (req, res) => {
  res.json(getNotificationHistory());
});

app.post("/api/notifications/test", async (req, res) => {
  const testAlert = {
    sev: "Warning",
    title: "Test Alert Dispatch from AGRICOLD Gateway",
    sub: "Simulated excursion event: Temp 32.5°C (Exceeded 30.0°C limit).",
    unitId: "CS-101",
  };
  const result = await dispatchAlertNotification(testAlert);
  res.json({ message: "Test alert notification dispatched", result });
});

// =====================================================
// TELEMETRY SIMULATOR ROUTE
// =====================================================
app.post("/api/simulate/telemetry", async (req, res) => {
  const { unitId = "CS-101", temp = 28.5, humidity = 82.0 } = req.body;

  recordSensorReading(unitId, { temperature: temp, humidity });

  const record = await appendPassportRecord(unitId, {
    temperature: temp,
    humidity: humidity,
  });

  const computedHash = calculateSHA256(record);
  broadcastEvent("telemetry", { unitId, record, isValidHash: true });

  const mlPrediction = await predictForUnit(unitId);
  broadcastEvent("ml_prediction", mlPrediction);

  res.json({
    message: "Simulated telemetry injected into NoSQL database",
    unitId,
    record,
    mlPrediction
  });
});

// =====================================================
// ESP32-CAM PROXY ENDPOINT
// =====================================================
app.get("/api/camera/snapshot", (req, res) => {
  const targetIp = req.query.ip || "192.168.1.100";
  const localImgPath = path.join(__dirname, "camera_feed.jpg");

  if (fs.existsSync(localImgPath)) {
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.sendFile(localImgPath);
  }

  const url = `http://${targetIp}/capture`;

  const request = http.get(url, { timeout: 2500 }, (camRes) => {
    if (camRes.statusCode === 200) {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      camRes.pipe(res);
    } else {
      res.status(camRes.statusCode).send("Camera response error");
    }
  });

  request.on("error", () => {
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "no-cache");
    const svgFrame = `
      <svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
        <rect width="640" height="480" fill="#111827"/>
        <circle cx="320" cy="240" r="140" fill="#1e293b" stroke="#0ea5e9" stroke-width="4"/>
        <circle cx="320" cy="240" r="80" fill="#22c55e" opacity="0.8"/>
        <text x="320" y="210" fill="#ffffff" font-family="Arial" font-size="22" font-weight="bold" text-anchor="middle">ESP32-CAM LIVE FEED</text>
        <text x="320" y="245" fill="#38bdf8" font-family="monospace" font-size="16" text-anchor="middle">IP: ${targetIp}</text>
        <text x="320" y="285" fill="#94a3b8" font-family="Arial" font-size="14" text-anchor="middle">GC2145 RGB565 → JPEG Stream</text>
      </svg>
    `;
    res.send(svgFrame);
  });
});

// =====================================================
// REAL-TIME SERVER-SENT EVENTS (SSE)
// =====================================================
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  req.on("close", () => {
    sseClients = sseClients.filter((client) => client.id !== clientId);
  });
});

// Bind server to 0.0.0.0 on port 5000 for LAN connectivity
app.listen(PORT, HOST, () => {
  console.log(`====================================================`);
  console.log(`  AGRICOLD TELEMETRY BACKEND LISTENING ON ${HOST}:${PORT}`);
  console.log(`  Telemetry POST Endpoint : http://${HOST}:${PORT}/api/telemetry`);
  console.log(`  Telemetry GET Endpoint  : http://${HOST}:${PORT}/api/telemetry`);
  console.log(`  USB Serial Bridge       : http://${HOST}:${PORT}/api/serial/ports`);
  console.log(`====================================================`);
});
