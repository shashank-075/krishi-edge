const express = require("express");
const cors = require("cors");
const http = require("http");
require("dotenv").config();
const { connectDB, getIsConnected } = require("./db");
const { getUnits, getUnitById, getPassportLogs, appendPassportRecord } = require("./dataStore");
const { verifyPassportChain, calculateSHA256 } = require("./passportEngine");
const { listSerialPorts, connectSerialPort, disconnectSerialPort, getSerialStatus, setBroadcastFunction } = require("./serialBridge");
const { dispatchAlertNotification, getSettings, updateSettings, getNotificationHistory } = require("./alertNotifier");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize MongoDB Connection (with graceful memory fallback)
connectDB();

// Store connected Server-Sent Events (SSE) clients
let sseClients = [];

function broadcastEvent(eventType, data) {
  sseClients.forEach((client) => {
    client.res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  });
}

// Pass broadcast function to Serial Bridge
setBroadcastFunction(broadcastEvent);

// =====================================================
// API HEALTH
// =====================================================
app.get("/api/health", (req, res) => {
  res.json({
    status: "online",
    system: "Krishi-Edge Backend & ESP32 Passport Gateway",
    database: getIsConnected() ? "MongoDB (Active)" : "In-Memory Mode",
    serialBridge: getSerialStatus(),
    timestamp: new Date().toISOString(),
    connectedClients: sseClients.length,
  });
});

// =====================================================
// UNITS ENDPOINTS
// =====================================================
app.get("/api/units", async (req, res) => {
  const units = await getUnits();
  res.json(units);
});

app.get("/api/units/:id", async (req, res) => {
  const unit = await getUnitById(req.params.id);
  if (!unit) {
    return res.status(404).json({ error: "Unit not found" });
  }
  const passport = await getPassportLogs(unit.id);
  res.json({
    ...unit,
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
// TELEMETRY INGESTION (From ESP32 Node)
// Supports ESP32 OLED main sensor code (temp > 30 => WARNING)
// =====================================================
app.post("/api/telemetry", async (req, res) => {
  const { unitId = "CS-101", recordNumber, timestamp, temperature, humidity, state, action, confidence, previousHash, currentHash, ...extraHardwareData } = req.body;

  if (temperature === undefined || humidity === undefined) {
    return res.status(400).json({ error: "Missing required sensor readings (temperature, humidity)" });
  }

  const computedState = state || (temperature > 30.0 ? "WARNING" : "NORMAL");

  const record = await appendPassportRecord(unitId, {
    recordNumber,
    timestamp,
    temperature,
    humidity,
    state: computedState,
    action: computedState === "WARNING" ? "VERIFY" : "CONTINUE",
    confidence: computedState === "WARNING" ? 85 : 95,
    previousHash,
    currentHash,
    ...extraHardwareData
  });

  const computedHash = calculateSHA256(record);
  const isValidHash = computedHash === record.currentHash;

  if (record.state === "WARNING" || record.state === "HOLD" || record.state === "FREEZE_RISK") {
    dispatchAlertNotification({
      sev: record.state === "WARNING" ? "Warning" : "Critical",
      title: `Condition Event: ${record.state} at ${unitId}`,
      sub: `Temperature ${record.temperature.toFixed(1)}°C · Humidity ${record.humidity.toFixed(1)}% RH`,
      unitId,
    });
  }

  broadcastEvent("telemetry", { unitId, record, isValidHash });

  res.status(201).json({
    message: "Condition record persisted to NoSQL database successfully",
    unitId,
    record,
    isValidHash,
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
    title: "Test Alert Dispatch from Krishi-Edge Gateway",
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

  const record = await appendPassportRecord(unitId, {
    temperature: temp,
    humidity: humidity,
  });

  const computedHash = calculateSHA256(record);
  broadcastEvent("telemetry", { unitId, record, isValidHash: true });

  res.json({
    message: "Simulated telemetry injected into NoSQL database",
    unitId,
    record,
  });
});

// =====================================================
// ESP32-CAM PROXY ENDPOINT
// =====================================================
app.get("/api/camera/snapshot", (req, res) => {
  const targetIp = req.query.ip || "192.168.1.100";
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
        <text x="320" y="440" fill="#ef4444" font-family="Arial" font-size="12" text-anchor="middle">● Hardware Offline (Simulation Active)</text>
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

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  KRISHI-EDGE BACKEND & ESP32 GATEWAY LISTENING ON PORT ${PORT}`);
  console.log(`  Telemetry Ingestion: http://localhost:${PORT}/api/telemetry`);
  console.log(`  USB Serial Bridge  : http://localhost:${PORT}/api/serial/ports`);
  console.log(`====================================================`);
});
