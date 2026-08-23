const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const { appendPassportRecord } = require("./dataStore");
const { calculateSHA256 } = require("./passportEngine");

let activePort = null;
let parser = null;
let currentConnectedPath = null;
let broadcastFn = null;

function setBroadcastFunction(fn) {
  broadcastFn = fn;
}

// Scans available USB COM ports on Windows / Linux / macOS
async function listSerialPorts() {
  try {
    const ports = await SerialPort.list();
    return ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer || "Unknown",
      serialNumber: p.serialNumber || "N/A",
      pnpId: p.pnpId || "N/A",
    }));
  } catch (err) {
    console.error("Error listing serial ports:", err.message);
    return [];
  }
}

// Connects to a specific COM port (e.g. COM3) at 115200 baud
async function connectSerialPort(portPath, baudRate = 115200) {
  if (activePort && activePort.isOpen) {
    await activePort.close();
  }

  return new Promise((resolve, reject) => {
    activePort = new SerialPort({ path: portPath, baudRate, autoOpen: false });
    parser = activePort.pipe(new ReadlineParser({ delimiter: "\r\n" }));

    activePort.open((err) => {
      if (err) {
        console.error(`❌ Failed to open serial port ${portPath}:`, err.message);
        currentConnectedPath = null;
        return reject(err);
      }

      currentConnectedPath = portPath;
      console.log(`🔌 Connected to USB Serial Port: ${portPath} @ ${baudRate} baud`);

      parser.on("data", (line) => {
        handleIncomingSerialLine(line);
      });

      activePort.on("close", () => {
        console.log(`🔌 USB Serial Port ${portPath} disconnected.`);
        currentConnectedPath = null;
      });

      resolve({ status: "connected", port: portPath, baudRate });
    });
  });
}

// Disconnect active USB serial port
async function disconnectSerialPort() {
  if (activePort && activePort.isOpen) {
    await activePort.close();
    currentConnectedPath = null;
    return { status: "disconnected" };
  }
  return { status: "not_connected" };
}

// Memory buffer for multi-line serial lines
let serialRecordBuffer = {};

function handleIncomingSerialLine(line) {
  const cleanLine = line.trim();
  if (!cleanLine) return;

  console.log(`[ESP32 Serial]: ${cleanLine}`);

  // Format 1: Final ESP32 OLED Code Serial output
  // "Temperature: 28.5 C | Humidity: 82 % | Status: NORMAL"
  const oledMatch = cleanLine.match(/Temperature:\s*([\d.]+)\s*C\s*\|\s*Humidity:\s*([\d.]+)\s*%\s*\|\s*Status:\s*(\w+)/i);
  if (oledMatch) {
    const temp = parseFloat(oledMatch[1]);
    const humidity = parseFloat(oledMatch[2]);
    const statusStr = oledMatch[3].toUpperCase();

    const record = {
      unitId: "CS-101",
      temperature: temp,
      humidity: humidity,
      state: statusStr === "WARNING" ? "WARNING" : temp < 2.0 ? "FREEZE_RISK" : "NORMAL",
      action: statusStr === "WARNING" ? "VERIFY" : temp < 2.0 ? "HOLD_VERIFY" : "CONTINUE",
      confidence: statusStr === "WARNING" ? 85 : 95,
    };

    saveAndBroadcast(record);
    return;
  }

  // Format 2: Pipe-delimited record matching LittleFS /condition.log format
  // recordNumber|timestamp|temperature|humidity|state|action|confidence|previousHash|currentHash
  if (cleanLine.includes("|")) {
    const parts = cleanLine.split("|");
    if (parts.length >= 4) {
      const record = {
        unitId: "CS-101",
        recordNumber: parseInt(parts[0]) || Date.now(),
        timestamp: parts[1],
        temperature: parseFloat(parts[2]),
        humidity: parseFloat(parts[3]),
        state: parts[4] || (parseFloat(parts[2]) > 30.0 ? "WARNING" : "NORMAL"),
        action: parts[5] || "CONTINUE",
        confidence: parseInt(parts[6]) || 95,
        previousHash: parts[7] || "",
        currentHash: parts[8] || ""
      };

      saveAndBroadcast(record);
      return;
    }
  }

  // Format 3: Multi-line key-value output from ESP32 Serial.println()
  if (cleanLine.startsWith("RECORD #")) {
    serialRecordBuffer = { unitId: "CS-101" };
    serialRecordBuffer.recordNumber = parseInt(cleanLine.split(":")[1]) || 1;
  } else if (cleanLine.startsWith("TIME")) {
    serialRecordBuffer.timestamp = cleanLine.split(":")[1]?.trim();
  } else if (cleanLine.startsWith("TEMP")) {
    const tempVal = parseFloat(cleanLine.split(":")[1]);
    if (!isNaN(tempVal)) serialRecordBuffer.temperature = tempVal;
  } else if (cleanLine.startsWith("HUMIDITY")) {
    const humVal = parseFloat(cleanLine.split(":")[1]);
    if (!isNaN(humVal)) serialRecordBuffer.humidity = humVal;
  } else if (cleanLine.startsWith("STATE")) {
    serialRecordBuffer.state = cleanLine.split(":")[1]?.trim();
  } else if (cleanLine.startsWith("ACTION")) {
    serialRecordBuffer.action = cleanLine.split(":")[1]?.trim();
  } else if (cleanLine.startsWith("PREVIOUS HASH")) {
    serialRecordBuffer.previousHash = cleanLine.split(":")[1]?.trim();
  } else if (cleanLine.startsWith("CURRENT HASH")) {
    serialRecordBuffer.currentHash = cleanLine.split(":")[1]?.trim();
    
    if (serialRecordBuffer.temperature !== undefined && serialRecordBuffer.humidity !== undefined) {
      saveAndBroadcast(serialRecordBuffer);
    }
    serialRecordBuffer = {};
  }
}

async function saveAndBroadcast(record) {
  try {
    const savedRecord = await appendPassportRecord(record.unitId || "CS-101", record);
    const isValidHash = calculateSHA256(savedRecord) === savedRecord.currentHash;

    if (broadcastFn) {
      broadcastFn("telemetry", { unitId: record.unitId || "CS-101", record: savedRecord, isValidHash, source: "USB_SERIAL" });
    }
  } catch (err) {
    console.error("Error persisting USB serial record:", err.message);
  }
}

function getSerialStatus() {
  return {
    connected: !!(activePort && activePort.isOpen),
    path: currentConnectedPath,
  };
}

module.exports = {
  listSerialPorts,
  connectSerialPort,
  disconnectSerialPort,
  getSerialStatus,
  setBroadcastFunction
};
