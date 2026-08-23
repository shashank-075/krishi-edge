"""
ColdRoot Vision — MQTT Bridge
--------------------------------
Subscribes to coldroot/+/freshness (published by the ESP32-CAM units),
and merges each result into the same per-unit record structure the
ColdRoot dashboard already uses for temp/humidity/battery — so the
frontend's genFreshness() can blend sensor-predicted and camera-confirmed
spoilage risk.

Writes results to a local JSON store (units_visual.json) that your backend
API can read from and serve to the dashboard. Swap out `save_result()` for
a real DB write (Postgres/Mongo/whatever ColdRoot's backend already uses).

USAGE:
    pip install paho-mqtt
    python mqtt_bridge.py
"""

import json
import pathlib
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

MQTT_BROKER = "YOUR_BROKER_IP_OR_HOST"
MQTT_PORT = 1883
MQTT_TOPIC = "coldroot/+/freshness"   # + wildcard matches any unit id

STORE_PATH = pathlib.Path("units_visual.json")


def load_store() -> dict:
    if STORE_PATH.exists():
        return json.loads(STORE_PATH.read_text())
    return {}


def save_result(unit_id: str, visual_freshness: str, confidence: float):
    store = load_store()
    store[unit_id] = {
        "visualFreshness": visual_freshness,
        "confidence": confidence,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    STORE_PATH.write_text(json.dumps(store, indent=2))
    print(f"[{unit_id}] visualFreshness={visual_freshness} "
          f"confidence={confidence:.3f}")


def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f"Connected to MQTT broker at {MQTT_BROKER}:{MQTT_PORT}")
        client.subscribe(MQTT_TOPIC)
        print(f"Subscribed to {MQTT_TOPIC}")
    else:
        print(f"Connection failed, rc={rc}")


def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode())
        unit_id = payload.get("unit")
        visual_freshness = payload.get("visualFreshness")
        confidence = float(payload.get("confidence", 0.0))
        if not unit_id or visual_freshness is None:
            print(f"Malformed payload on {msg.topic}: {msg.payload}")
            return
        save_result(unit_id, visual_freshness, confidence)
    except (json.JSONDecodeError, ValueError, TypeError) as e:
        print(f"Failed to parse message on {msg.topic}: {e}")


def main():
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = on_connect
    client.on_message = on_message

    while True:
        try:
            client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
            client.loop_forever()
        except Exception as e:
            print(f"MQTT connection error: {e} — retrying in 5s")
            time.sleep(5)


if __name__ == "__main__":
    main()
