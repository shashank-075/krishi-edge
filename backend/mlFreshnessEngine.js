const { getUnitById } = require("./dataStore");

// Visual freshness predictions per unit ID
const visualStore = {
  "CS-101": { visualFreshness: "fresh", confidence: 0.94, updatedAt: new Date().toISOString() },
  "CS-102": { visualFreshness: "fresh", confidence: 0.88, updatedAt: new Date().toISOString() },
  "CS-103": { visualFreshness: "fresh", confidence: 0.72, updatedAt: new Date().toISOString() },
  "CS-104": { visualFreshness: "spoiling", confidence: 0.89, updatedAt: new Date().toISOString() },
};

function getVisualFreshness(unitId) {
  return visualStore[unitId] || { visualFreshness: "fresh", confidence: 0.85, updatedAt: new Date().toISOString() };
}

function getAllVisualFreshness() {
  return visualStore;
}

function updateVisualFreshness(unitId, visualFreshness, confidence) {
  const record = {
    unitId,
    visualFreshness: visualFreshness === "stale" || visualFreshness === "spoiling" ? "spoiling" : "fresh",
    confidence: parseFloat(confidence) || 0.85,
    updatedAt: new Date().toISOString()
  };

  visualStore[unitId] = record;

  // Sync to unit in memory
  const unit = getUnitById(unitId);
  if (unit) {
    unit.visualFreshness = record.visualFreshness;
    unit.visualConfidence = record.confidence;
  }

  console.log(`🤖 [ML Vision Inference] Unit ${unitId} classified as: ${record.visualFreshness} (${(record.confidence * 100).toFixed(1)}% confidence)`);
  return record;
}

module.exports = {
  getVisualFreshness,
  getAllVisualFreshness,
  updateVisualFreshness
};
