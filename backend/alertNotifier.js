const http = require("http");
const https = require("https");

// Configurable notification channels
let settings = {
  telegramEnabled: false,
  telegramBotToken: "",
  telegramChatId: "",
  webhookEnabled: false,
  webhookUrl: "",
  smsEnabled: true,
  farmerPhone: "+91-9876543210"
};

// Log of sent notifications
const notificationHistory = [];

function updateSettings(newSettings) {
  settings = { ...settings, ...newSettings };
  console.log("🔔 Notification Settings Updated:", settings);
  return settings;
}

function getSettings() {
  return settings;
}

function getNotificationHistory() {
  return notificationHistory;
}

/**
 * Triggers instant multi-channel alert notifications when critical condition events occur
 */
async function dispatchAlertNotification(alert) {
  const logEntry = {
    id: `NOTIF-${Date.now()}`,
    timestamp: new Date().toISOString(),
    title: alert.title || alert.message || "Cold-Chain Alert",
    severity: alert.sev || alert.severity || "Warning",
    unitId: alert.unitId || "CS-101",
    sub: alert.sub || "",
    dispatchedChannels: []
  };

  // 1. Telegram Bot Notification
  if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
    try {
      const text = `🚨 *KRISHI-EDGE ALERT* 🚨\n\n` +
        `*Title:* ${logEntry.title}\n` +
        `*Severity:* ${logEntry.severity}\n` +
        `*Unit:* ${logEntry.unitId}\n` +
        `*Details:* ${logEntry.sub}\n` +
        `*Time:* ${logEntry.timestamp}`;

      await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, text);
      logEntry.dispatchedChannels.push("Telegram");
    } catch (e) {
      console.error("Failed to send Telegram alert:", e.message);
    }
  }

  // 2. Custom HTTP Webhook Notification
  if (settings.webhookEnabled && settings.webhookUrl) {
    try {
      await sendWebhook(settings.webhookUrl, logEntry);
      logEntry.dispatchedChannels.push("Webhook");
    } catch (e) {
      console.error("Failed to post to Webhook URL:", e.message);
    }
  }

  // 3. SMS Simulator Dispatch Log
  if (settings.smsEnabled) {
    logEntry.dispatchedChannels.push(`SMS (${settings.farmerPhone})`);
    console.log(`📱 [SMS DISPATCH to ${settings.farmerPhone}]: ${logEntry.title} — ${logEntry.sub}`);
  }

  notificationHistory.unshift(logEntry);
  if (notificationHistory.length > 50) notificationHistory.pop();

  return logEntry;
}

function sendTelegramMessage(botToken, chatId, text) {
  return new Promise((resolve, reject) => {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" });

    const req = https.request(url, {
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
        if (res.statusCode === 200) resolve(data);
        else reject(new Error(`Telegram API responded with status ${res.statusCode}: ${data}`));
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function sendWebhook(webhookUrl, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const parsedUrl = new URL(webhookUrl);
    const client = parsedUrl.protocol === "https:" ? https : http;

    const req = client.request(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      },
      timeout: 5000
    }, (res) => {
      resolve();
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

module.exports = {
  dispatchAlertNotification,
  getSettings,
  updateSettings,
  getNotificationHistory
};
