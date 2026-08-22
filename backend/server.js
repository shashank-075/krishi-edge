const express = require("express");
const cors = require("cors");
const http = require("http");
require("dotenv").config();
const { connectDB, getIsConnected } = require("./db");
const { getUnits, getUnitById, getPassportLogs, appendPassportRecord } = require("./dataStore");
const { verifyPassportChain, calculateSHA256 } = require("./passportEngine");

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

// =====================================================
// API HEALTH
// =====================================================
app.get("/api/health", (req, res) => {
  res.json({
    status: "online",
    system: "Krishi-Edge Backend & ESP32 Passport Gateway",
    database: getIsConnected() ? "MongoDB (Active)" : "In-Memory Mode",
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
  res.json({ ...unit, passportCount: passport.length, latestPassport: passport[passport.length - 1] || null });
});

// =====================================================
// CONDITION PASSPORT & HASH CHAIN ENDPOINTS
// =====================================================

// Get raw condition log records for a unit
app.get("/api/passport/:unitId", async (req, res) => {
  const { unitId } = req.params;
  const logs = await getPassportLogs(unitId);
  res.json({
    unitId,
    totalRecords: logs.length,
    records: logs,
  });
});

// Cryptographic verification of SHA-256 hash chain
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
// Stores records dynamically in MongoDB (NoSQL)
// =====================================================
app.post("/api/telemetry", async (req, res) => {
  const { unitId = "CS-101", recordNumber, timestamp, temperature, humidity, state, action, confidence, previousHash, currentHash, ...extraHardwareData } = req.body;

  if (temperature === undefined || humidity === undefined) {
    return res.status(400).json({ error: "Missing required sensor readings (temperature, humidity)" });
  }

  const record = await appendPassportRecord(unitId, {
    recordNumber,
    timestamp,
    temperature,
    humidity,
    state,
    action,
    confidence,
    previousHash,
    currentHash,
    ...extraHardwareData // Flexible NoSQL: Any extra fields sent by ESP32 are persisted dynamically!
  });

  const computedHash = calculateSHA256(record);
  const isValidHash = computedHash === record.currentHash;

  broadcastEvent("telemetry", { unitId, record, isValidHash });

  res.status(201).json({
    message: "Condition record persisted to NoSQL database successfully",
    unitId,
    record,
    isValidHash,
  });
});

// =====================================================
// TELEMETRY SIMULATOR ROUTE
// =====================================================
app.post("/api/simulate/telemetry", async (req, res) => {
  const { unitId = "CS-101", temp = 4.5, humidity = 85.0 } = req.body;

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
  console.log(`  Hash Chain Verifier: http://localhost:${PORT}/api/passport/verify/CS-101`);
  console.log(`  ESP32-CAM Proxy    : http://localhost:${PORT}/api/camera/snapshot`);
  console.log(`====================================================`);
});
