"""
Converts models/coldroot_freshness_int8.tflite into a C header file
(model_data.h) containing a byte array — this is how you embed the model
directly into ESP32-CAM firmware (Arduino / ESP-IDF), since the board has
no filesystem to load a .tflite file from at runtime in most setups.

USAGE:
    python convert_to_c_array.py

OUTPUT:
    models/model_data.h
"""

import pathlib

MODEL_DIR = pathlib.Path("models")
TFLITE_PATH = MODEL_DIR / "coldroot_freshness_int8.tflite"
HEADER_PATH = MODEL_DIR / "model_data.h"
ARRAY_NAME = "coldroot_freshness_model"


def main():
    if not TFLITE_PATH.exists():
        raise SystemExit(f"{TFLITE_PATH} not found — run train_model.py first.")

    data = TFLITE_PATH.read_bytes()

    lines = [
        "// Auto-generated from coldroot_freshness_int8.tflite",
        "// Do not edit by hand — regenerate with convert_to_c_array.py",
        "#ifndef COLDROOT_FRESHNESS_MODEL_H",
        "#define COLDROOT_FRESHNESS_MODEL_H",
        "",
        "alignas(8) const unsigned char " + ARRAY_NAME + "[] = {",
    ]

    hex_bytes = [f"0x{b:02x}" for b in data]
    for i in range(0, len(hex_bytes), 12):
        lines.append("  " + ", ".join(hex_bytes[i:i + 12]) + ",")

    lines += [
        "};",
        f"const unsigned int {ARRAY_NAME}_len = {len(data)};",
        "",
        "#endif  // COLDROOT_FRESHNESS_MODEL_H",
        "",
    ]

    HEADER_PATH.write_text("\n".join(lines))
    print(f"Wrote {HEADER_PATH} ({len(data)} bytes, "
          f"{len(data)/1024:.1f} KB as source)")


if __name__ == "__main__":
    main()
