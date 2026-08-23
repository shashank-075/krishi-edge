const { calculateSHA256, evaluateConditionState } = require("./passportEngine");
const { PassportModel, UnitModel, getIsConnected } = require("./db");

const NER_STATES = [
  "Assam", "Meghalaya", "Manipur", "Mizoram",
  "Nagaland", "Tripura", "Arunachal Pradesh", "Sikkim"
];

const VILLAGES = [
  "Diphu Collection Centre", "Nongpoh Farmer Co-op", "Ukhrul Aggregation Point",
  "Champhai Market Hub", "Kohima Village Cluster", "Udaipur Growers Point",
  "Ziro Valley Depot", "Gangtok Hill Co-op", "Sonapur Farm Gate",
  "Tura Market Centre", "Imphal Rural Hub", "Aizawl Collection Point"
];

const PRODUCE = [
  "Fresh Fruits (Apple, Pomegranate, Orange)", "Tomato", "Cabbage", "French Beans", "Leafy Greens",
  "Chilli", "Cauliflower", "Carrot", "Capsicum"
];

let units = [
  {
    id: "CS-101",
    village: "Diphu Solar Prototype Unit 1",
    state: "Assam",
    status: "Healthy",
    mode: "Solar (3S Li-ion 18650)",
    capacityL: 3,
    lat: 25.84,
    lng: 93.43,
    temp: 4.2,
    humidity: 86.5,
    battery: 96.67,
    batterySpec: "18650 3S Li-ion Battery Configuration (11.1V / 12.6V Pack)",
    solarW: 38.5,
    solarStatus: "Current State of Charge using Solar: 96.67%",
    produce: "Fresh Fruits (1 Apple, 1 Pomegranate, 1 Orange)",
    loadKg: 0.4,
    doorOpensToday: 2,
    lastPowerFailureH: 48,
    camIp: "192.168.1.100",
    lastSeen: new Date().toISOString(),
  },
  {
    id: "CS-102",
    village: "Nongpoh Farmer Co-op 2",
    state: "Meghalaya",
    status: "Healthy",
    mode: "Solar (3S Li-ion 18650)",
    capacityL: 3,
    lat: 25.90,
    lng: 91.88,
    temp: 3.8,
    humidity: 89.0,
    battery: 95.4,
    solarW: 41.0,
    produce: "Cabbage",
    loadKg: 0.4,
    doorOpensToday: 4,
    lastPowerFailureH: 72,
    lastSeen: new Date().toISOString(),
  },
  {
    id: "CS-103",
    village: "Ukhrul Aggregation Point 3",
    state: "Manipur",
    status: "Warning",
    mode: "Eco Mode",
    capacityL: 3,
    lat: 25.11,
    lng: 94.36,
    temp: 7.2,
    humidity: 92.4,
    battery: 42.0,
    solarW: 14.2,
    produce: "French Beans",
    loadKg: 0.4,
    doorOpensToday: 8,
    lastPowerFailureH: 6,
    lastSeen: new Date().toISOString(),
  }
];

const conditionPassports = {};

function initSamplePassports() {
  const cs101Logs = [];
  let prevHash = "0000000000000000000000000000000000000000000000000000000000000000";
  const now = new Date();

  for (let i = 1; i <= 10; i++) {
    const timeStr = new Date(now.getTime() - (11 - i) * 5000)
      .toISOString()
      .replace("T", " ")
      .substring(0, 19);

    const temp = +(3.8 + (i % 3) * 0.3).toFixed(1);
    const humidity = +(85.0 + i * 0.4).toFixed(1);
    const state = "NORMAL";
    const action = "CONTINUE";
    const confidence = 95;

    const recordData = {
      recordNumber: i,
      timestamp: timeStr,
      temperature: temp,
      humidity: humidity,
      state,
      action,
      confidence,
      previousHash: prevHash,
    };

    const currentHash = calculateSHA256(recordData);
    recordData.currentHash = currentHash;

    cs101Logs.push(recordData);
    prevHash = currentHash;
  }

  conditionPassports["CS-101"] = cs101Logs;
}

initSamplePassports();

async function getUnits() {
  if (getIsConnected()) {
    try {
      const dbUnits = await UnitModel.find({}).lean();
      if (dbUnits && dbUnits.length > 0) return dbUnits;
    } catch (e) {
      console.error("MongoDB fetch units error:", e);
    }
  }
  return units;
}

async function getUnitById(id) {
  if (getIsConnected()) {
    try {
      const dbUnit = await UnitModel.findOne({ id }).lean();
      if (dbUnit) return dbUnit;
    } catch (e) {
      console.error("MongoDB fetch unit error:", e);
    }
  }
  return units.find((u) => u.id === id);
}

async function getPassportLogs(unitId) {
  if (getIsConnected()) {
    try {
      const logs = await PassportModel.find({ unitId }).sort({ recordNumber: 1 }).lean();
      if (logs && logs.length > 0) return logs;
    } catch (e) {
      console.error("MongoDB fetch passport logs error:", e);
    }
  }
  return conditionPassports[unitId] || [];
}

async function appendPassportRecord(unitId, recordData) {
  const logs = await getPassportLogs(unitId);
  const lastRecord = logs.length > 0 ? logs[logs.length - 1] : null;

  const recordNumber = recordData.recordNumber || (lastRecord ? lastRecord.recordNumber + 1 : 1);
  const previousHash = recordData.previousHash || (lastRecord ? lastRecord.currentHash : "0000000000000000000000000000000000000000000000000000000000000000");

  const timestamp = recordData.timestamp || new Date().toISOString().replace("T", " ").substring(0, 19);
  const temp = parseFloat(recordData.temperature);
  const humidity = parseFloat(recordData.humidity);

  const evalResult = evaluateConditionState(temp, humidity);
  const state = recordData.state || evalResult.state;
  const action = recordData.action || evalResult.action;
  const confidence = recordData.confidence || evalResult.confidence;

  const entry = {
    unitId,
    ...recordData,
    recordNumber: Number(recordNumber),
    timestamp: timestamp || recordData.timestamp || new Date().toISOString().replace("T", " ").substring(0, 19),
    temperature: temp,
    humidity: humidity,
    state,
    action,
    confidence: Number(confidence),
    previousHash,
  };

  entry.currentHash = recordData.currentHash || calculateSHA256(entry);

  if (getIsConnected()) {
    try {
      await PassportModel.create(entry);
      await UnitModel.findOneAndUpdate(
        { id: unitId },
        {
          temp,
          humidity,
          status: state === "NORMAL" ? "Healthy" : state === "WARNING" ? "Warning" : "Critical",
          lastSeen: new Date()
        },
        { upsert: true }
      );
    } catch (e) {
      console.error("MongoDB write error:", e);
    }
  }

  if (!conditionPassports[unitId]) conditionPassports[unitId] = [];
  conditionPassports[unitId].push(entry);

  const u = units.find((x) => x.id === unitId);
  if (u) {
    u.temp = temp;
    u.humidity = humidity;
    u.status = state === "NORMAL" ? "Healthy" : state === "WARNING" ? "Warning" : "Critical";
    u.lastSeen = new Date().toISOString();
  }

  return entry;
}

module.exports = {
  getUnits,
  getUnitById,
  getPassportLogs,
  appendPassportRecord,
  NER_STATES,
  VILLAGES,
  PRODUCE,
};
