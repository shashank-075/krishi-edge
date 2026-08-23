# AgriCold Vision — Freshness Classifier

On-device produce freshness detection for AgriCold's solar cold storage units, running on ESP32-CAM. Classifies crates as **fresh** or **rotten** for apples, bananas, and oranges, publishes the result over MQTT, and merges it into the same per-unit record your dashboard already uses for temp/humidity/battery.

## Pipeline overview

```
Kaggle dataset → prepare_dataset.py → train_model.py → convert_to_c_array.py
                                                              ↓
                                          esp32cam_inference.ino (on device)
                                                              ↓
                                          MQTT  →  mqtt_bridge.py  →  dashboard
```

## 1. Get the dataset

Download from Kaggle:
https://www.kaggle.com/datasets/user2036/fruit-freshness-dataset-v1

Unzip it anywhere, then run:

```bash
python prepare_dataset.py /path/to/unzipped/download
```

This scans the raw download and maps the 6 raw class folders into a clean train/test split:

```
data/
  train/
    fresh_apple/     *.jpg
    rotten_apple/    *.jpg
    fresh_banana/    *.jpg
    rotten_banana/   *.jpg
    fresh_orange/    *.jpg
    rotten_orange/   *.jpg
  test/
    ... (same structure)
```

## 2. Train

```bash
pip install -r requirements.txt
python train_model.py
```

Two-phase training: a classifier head on top of a frozen MobileNetV2 (alpha=0.35, the smallest official width multiplier — chosen for ESP32-CAM's RAM budget), then fine-tuning the top backbone layers. Includes augmentation (brightness/contrast variation especially, since cold-storage lighting differs from the dataset's daylight photos). At the end of training, a classification report and confusion matrix will be generated.

Outputs in `models/`:
- `agricold_freshness.h5` — full Keras model
- `agricold_freshness.tflite` — float TFLite export
- `agricold_freshness_int8.tflite` — **the deployment target** — int8 quantized, ~4x smaller

## 3. Convert for ESP32-CAM

```bash
python convert_to_c_array.py
```

Produces `models/model_data.h` — the quantized model as a C byte array, since the ESP32-CAM has no filesystem to load a `.tflite` file from at runtime in a typical Arduino build.

## 4. Flash the firmware

Copy `model_data.h` into `esp32cam_inference/`, open `esp32cam_inference.ino` in the Arduino IDE, install:

- `TensorFlowLite_ESP32`
- `PubSubClient`
- ESP32 board package (bundles `esp32-camera`)

Fill in WiFi credentials, MQTT broker address, and `UNIT_ID` (match your dashboard's unit `id`, e.g. `CS-101`) — one flash per physical unit, changing `UNIT_ID` each time.

The firmware wakes every 15 minutes, captures a 96×96 RGB frame, converts RGB565→RGB888, applies the same [-1,1] normalization used in training, quantizes it using the model's own scale/zero-point (read from the model file, not hardcoded), runs inference against the 6 classes (`fresh_apple`, `fresh_banana`, `fresh_orange`, `rotten_apple`, `rotten_banana`, `rotten_orange`), and publishes:

```json
{"unit": "CS-101", "visualFreshness": "fresh_apple", "confidence": 0.87}
```

to `agricold/CS-101/freshness`, then deep-sleeps to conserve battery.

## 5. Run the bridge

```bash
python mqtt_bridge.py
```

Subscribes to `agricold/+/freshness` across all units, writes results to `units_visual.json` keyed by unit ID. Swap `save_result()` for a real DB write once you wire it to AgriCold's actual backend.

## 6. Wire it into the dashboard

Merge each unit's `visualFreshness` / `confidence` into the record already carrying `temp`, `humidity`, `battery`. Feed it into `genFreshness()` alongside the existing temperature-based `spoilageRisk` so `FreshnessSection` and `UnitModal` can show both sensor-predicted and camera-confirmed status side by side.

## Notes

- Only apple, banana, and orange are covered by this dataset. Your other crops need self-captured training images from the actual deployed units — no solid public dataset exists for them. Once you have ~100-150 labeled images per crop, drop them into `data/train/` and `data/test/`, then rerun `train_model.py` — ensure `CLASS_NAMES` is updated.
- `kTensorArenaSize` (130KB) in the firmware has headroom for this model size; if you change `alpha` or `IMG_SIZE` in training, re-check this and adjust if `AllocateTensors()` fails.
- MQTT was chosen over HTTP for the uplink because it's far lighter on data and battery, which matters given inconsistent connectivity — if a unit has no WiFi at all, swap `WiFi.h` for a SIM800L (GSM) or LoRa module and publish over that instead.
