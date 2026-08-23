const http = require("http");
const https = require("https");

// Configurable ML FastAPI service URL
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://172.21.42.90:8000";

// Real telemetry history storage per unit ID
// Only populated when actual ESP32 readings arrive via HTTP POST or USB Serial
const sensorHistory = {};

// In-memory latest ML predictions per unit
const latestPredictions = {};

/**
 * Record a raw telemetry reading from physical ESP32 into history
 */
function recordSensorReading(unitId, reading) {
  if (!sensorHistory[unitId]) {
    sensorHistory[unitId] = [];
  }

  sensorHistory[unitId].push({
    timestamp: Date.now(),
    temperature: parseFloat(reading.temperature) || 28.5,
    humidity: parseFloat(reading.humidity) || 82.0,
    power: reading.power !== undefined ? Boolean(reading.power) : true,
  });

  // Keep rolling history of last 2000 readings (~24-48 hours)
  if (sensorHistory[unitId].length > 2000) {
    sensorHistory[unitId].shift();
  }

  console.log(`📊 [Real ESP32 Telemetry Recorded for ${unitId}]: Temp=${reading.temperature}°C, Hum=${reading.humidity}%, Total Samples=${sensorHistory[unitId].length}`);
}

/**
 * Compute derived feature values from REAL ESP32 telemetry history.
 * If zero real readings exist, falls back to contract example values.
 */
function computeDerivedFeatures(unitId = "CS-101", produceType = "tomato") {
  const readings = sensorHistory[unitId] || [];

  // IF NO REAL DATA IS AVAILABLE FROM ESP32 YET -> USE EXAMPLE FALLBACK CONTRACT
  if (readings.length === 0) {
    return {
      produce_type: produceType.toLowerCase(),
      storage_hours: 48.0,
      avg_temperature: 9.2,
      max_temperature: 13.5,
      min_temperature: 7.8,
      temperature_std: 1.2,
      time_above_10c: 4.2,
      time_above_12c: 1.1,
      avg_humidity: 89.0,
      max_humidity: 95.0,
      humidity_std: 2.4,
      time_above_90rh: 8.5,
      time_above_95rh: 1.2,
      power_outages: 1,
      total_outage_hours: 1.5,
      longest_outage_hours: 1.5,
      temperature_recovery_minutes: 35.0,
      isRealData: false,
      sampleCount: 0
    };
  }

  // REAL DATA AVAILABLE -> COMPUTE 100% FROM ESP32 TELEMETRY READINGS
  const temps = readings.map((r) => r.temperature);
  const hums = readings.map((r) => r.humidity);

  const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
  const maxTemp = Math.max(...temps);
  const minTemp = Math.min(...temps);

  // Standard deviation of real temperatures
  const tempVariance = temps.reduce((a, b) => a + Math.pow(b - avgTemp, 2), 0) / temps.length;
  const tempStd = Math.sqrt(tempVariance);

  const avgHum = hums.reduce((a, b) => a + b, 0) / hums.length;
  const maxHum = Math.max(...hums);
  const humVariance = hums.reduce((a, b) => a + Math.pow(b - avgHum, 2), 0) / hums.length;
  const humStd = Math.sqrt(humVariance);

  // Excursion hours based on reading intervals
  const sampleIntervalHours = readings.length > 1 
    ? Math.max(0.01, (readings[readings.length - 1].timestamp - readings[0].timestamp) / (3600000 * readings.length))
    : 0.1;

  const timeAbove10c = readings.filter((r) => r.temperature > 10.0).length * sampleIntervalHours;
  const timeAbove12c = readings.filter((r) => r.temperature > 12.0).length * sampleIntervalHours;

  const timeAbove90rh = readings.filter((r) => r.humidity > 90.0).length * sampleIntervalHours;
  const timeAbove95rh = readings.filter((r) => r.humidity > 95.0).length * sampleIntervalHours;

  // Power outage statistics from real sensor history
  let powerOutages = 0;
  let totalOutageHours = 0;
  let currentOutageHours = 0;
  let longestOutageHours = 0;

  readings.forEach((r) => {
    if (!r.power) {
      currentOutageHours += sampleIntervalHours;
      totalOutageHours += sampleIntervalHours;
      if (currentOutageHours > longestOutageHours) longestOutageHours = currentOutageHours;
    } else {
      if (currentOutageHours > 0) {
        powerOutages++;
        currentOutageHours = 0;
      }
    }
  });

  const firstTimestamp = readings[0].timestamp;
  const storageHours = Math.max(0.1, (Date.now() - firstTimestamp) / 3600000);

  return {
    produce_type: produceType.toLowerCase(),
    storage_hours: parseFloat(storageHours.toFixed(1)),
    avg_temperature: parseFloat(avgTemp.toFixed(1)),
    max_temperature: parseFloat(maxTemp.toFixed(1)),
    min_temperature: parseFloat(minTemp.toFixed(1)),
    temperature_std: parseFloat(tempStd.toFixed(2)),
    time_above_10c: parseFloat(timeAbove10c.toFixed(1)),
    time_above_12c: parseFloat(timeAbove12c.toFixed(1)),
    avg_humidity: parseFloat(avgHum.toFixed(1)),
    max_humidity: parseFloat(maxHum.toFixed(1)),
    humidity_std: parseFloat(humStd.toFixed(2)),
    time_above_90rh: parseFloat(timeAbove90rh.toFixed(1)),
    time_above_95rh: parseFloat(timeAbove95rh.toFixed(1)),
    power_outages: powerOutages,
    total_outage_hours: parseFloat(totalOutageHours.toFixed(1)),
    longest_outage_hours: parseFloat(longestOutageHours.toFixed(1)),
    temperature_recovery_minutes: powerOutages > 0 ? 35.0 : 0.0,
    isRealData: true,
    sampleCount: readings.length
  };
}

/**
 * Check ML FastAPI Service Health (GET /health)
 */
function checkMLServiceHealth() {
  return new Promise((resolve) => {
    const healthUrl = `${ML_SERVICE_URL}/health`;
    const parsedUrl = new URL(healthUrl);
    const client = parsedUrl.protocol === "https:" ? https : http;

    const req = client.get(healthUrl, { timeout: 3000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            resolve({ online: true, url: healthUrl, response: JSON.parse(data) });
          } catch (e) {
            resolve({ online: true, url: healthUrl, response: data });
          }
        } else {
          resolve({ online: false, url: healthUrl, error: `Status code ${res.statusCode}` });
        }
      });
    });

    req.on("error", (err) => {
      resolve({ online: false, url: healthUrl, error: err.message });
    });

    req.end();
  });
}

/**
 * Dispatch POST /predict request to FastAPI ML Service
 */
function fetchMLPrediction(features) {
  return new Promise((resolve, reject) => {
    const predictUrl = `${ML_SERVICE_URL}/predict`;
    const payload = JSON.stringify(features);
    const parsedUrl = new URL(predictUrl);
    const client = parsedUrl.protocol === "https:" ? https : http;

    const req = client.request(predictUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      },
      timeout: 5000
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (e) {
            reject(new Error("Failed to parse ML response JSON"));
          }
        } else {
          reject(new Error(`ML service error HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

/**
 * Main prediction orchestrator: fetches from FastAPI service with robust fallback
 */
async function predictForUnit(unitId = "CS-101", customFeatures = null) {
  const features = customFeatures || computeDerivedFeatures(unitId);

  try {
    const mlResponse = await fetchMLPrediction(features);
    const result = {
      ...mlResponse,
      unitId,
      features,
      updatedAt: new Date().toISOString(),
      source: "FASTAPI_ML_SERVICE",
      serviceUrl: ML_SERVICE_URL,
      isRealData: features.isRealData,
      sampleCount: features.sampleCount || 0
    };
    latestPredictions[unitId] = result;
    console.log(`🤖 [ML Prediction for ${unitId}] (${features.isRealData ? 'REAL ESP32 SENSOR DATA' : 'EXAMPLE FALLBACK'}): Risk=${result.spoilage_risk}, Prob=${result.spoilage_probability_percent}%, ShelfLife=${result.remaining_shelf_life_days}d`);
    return result;
  } catch (err) {
    console.warn(`⚠️ [ML Service Unreachable at ${ML_SERVICE_URL}]: ${err.message}. Using intelligent local fallback calculation.`);
    
    // Fallback calculation algorithm so demo never fails
    const tempRiskScore = Math.min(1.0, Math.max(0.1, (features.avg_temperature - 2.0) / 10.0 + features.time_above_12c * 0.05));
    const isHigh = tempRiskScore > 0.7;
    const isMed = tempRiskScore > 0.35;
    const riskLabel = isHigh ? "HIGH" : isMed ? "MEDIUM" : "LOW";
    const probPercent = parseFloat((tempRiskScore * 100).toFixed(2));
    const shelfLifeDays = parseFloat(Math.max(1.0, (14.0 - tempRiskScore * 10.0)).toFixed(2));

    const fallbackResult = {
      spoilage_risk: riskLabel,
      spoilage_probability: parseFloat(tempRiskScore.toFixed(4)),
      spoilage_probability_percent: probPercent,
      remaining_shelf_life_days: shelfLifeDays,
      risk_probabilities: {
        low: isHigh ? 10.2 : isMed ? 25.4 : 75.8,
        medium: isHigh ? 25.8 : isMed ? 51.71 : 18.2,
        high: isHigh ? 64.0 : isMed ? 22.89 : 6.0
      },
      unitId,
      features,
      updatedAt: new Date().toISOString(),
      source: "LOCAL_FALLBACK_CALCULATION",
      serviceUrl: ML_SERVICE_URL,
      isRealData: features.isRealData,
      sampleCount: features.sampleCount || 0,
      note: "FastAPI server offline — local calculation active"
    };

    latestPredictions[unitId] = fallbackResult;
    return fallbackResult;
  }
}

function getLatestPrediction(unitId = "CS-101") {
  return latestPredictions[unitId] || null;
}

module.exports = {
  recordSensorReading,
  computeDerivedFeatures,
  checkMLServiceHealth,
  predictForUnit,
  getLatestPrediction,
  ML_SERVICE_URL
};
