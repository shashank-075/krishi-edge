const mongoose = require("mongoose");
require("dotenv").config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/krishi-edge";

let isConnected = false;

async function connectDB() {
  try {
    // 3 second connection timeout so backend starts immediately even if local MongoDB server is offline
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 3000 });
    isConnected = true;
    console.log("🍃 Local MongoDB Connected Successfully at mongodb://127.0.0.1:27017/krishi-edge");
  } catch (err) {
    isConnected = false;
    console.warn("⚠️ Local MongoDB Server not running on port 27017. Operating in flexible memory mode.");
    console.warn("   (Install MongoDB Community Server or run MongoDB via Docker to enable persistent storage).");
  }
}

// 1. Condition Passport Ledger Schema (NoSQL document with strict: false for dynamic hardware fields)
const passportSchema = new mongoose.Schema(
  {
    unitId: { type: String, required: true, index: true },
    recordNumber: { type: Number, required: true },
    timestamp: { type: String, required: true },
    temperature: { type: Number },
    humidity: { type: Number },
    state: { type: String },
    action: { type: String },
    confidence: { type: Number },
    previousHash: { type: String },
    currentHash: { type: String },
    createdAt: { type: Date, default: Date.now }
  },
  { strict: false }
);

// 2. Storage Unit Schema
const unitSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    village: { type: String },
    state: { type: String },
    status: { type: String },
    mode: { type: String },
    capacityL: { type: Number },
    lat: { type: Number },
    lng: { type: Number },
    temp: { type: Number },
    humidity: { type: Number },
    battery: { type: Number },
    solarW: { type: Number },
    produce: { type: String },
    loadKg: { type: Number },
    camIp: { type: String },
    lastSeen: { type: Date, default: Date.now }
  },
  { strict: false }
);

const PassportModel = mongoose.model("Passport", passportSchema);
const UnitModel = mongoose.model("Unit", unitSchema);

module.exports = {
  connectDB,
  PassportModel,
  UnitModel,
  getIsConnected: () => isConnected
};
