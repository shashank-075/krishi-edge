"""
ColdRoot Vision — Freshness Classifier Training Script
--------------------------------------------------------
Trains a lightweight MobileNetV2-based classifier on the Kaggle
"Fresh and Stale Images of Fruits and Vegetables" dataset (Tomato + Capsicum
subset), then exports an int8-quantized TFLite model small enough to run
on an ESP32-CAM via TensorFlow Lite for Microcontrollers.

USAGE:
    1. Download the dataset from:
       https://www.kaggle.com/datasets/raghavrpotdar/fresh-and-stale-images-of-fruits-and-vegetables
    2. Unzip it so you have a folder structure like:
         data/
           fresh_tomato/*.jpg
           stale_tomato/*.jpg
           fresh_capsicum/*.jpg
           stale_capsicum/*.jpg
       (delete the other crop folders — apple/banana/bittergourd/orange —
        or set CROPS below to include them if you want a broader model)
    3. pip install -r requirements.txt
    4. python train_model.py

OUTPUT:
    models/coldroot_freshness.h5          - full Keras model
    models/coldroot_freshness.tflite      - float TFLite model
    models/coldroot_freshness_int8.tflite - quantized model for ESP32-CAM
"""

import os
import pathlib
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models, callbacks

# ----------------------------- config -----------------------------
DATA_DIR = pathlib.Path("data")
MODEL_DIR = pathlib.Path("models")
MODEL_DIR.mkdir(exist_ok=True)

# Which crop folders to include. Add more once you have data for them.
CROPS = ["tomato", "capsicum"]

IMG_SIZE = (96, 96)      # small on purpose — ESP32-CAM has very limited RAM
BATCH_SIZE = 16
EPOCHS = 25
LEARNING_RATE = 1e-4
SEED = 42

CLASS_NAMES = ["fresh", "stale"]  # 0 = fresh, 1 = stale


def build_datasets():
    """Loads images from data/fresh_<crop> and data/stale_<crop> folders."""
    train_ds = tf.keras.utils.image_dataset_from_directory(
        DATA_DIR,
        validation_split=0.2,
        subset="training",
        seed=SEED,
        image_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
        label_mode="binary",
    )
    val_ds = tf.keras.utils.image_dataset_from_directory(
        DATA_DIR,
        validation_split=0.2,
        subset="validation",
        seed=SEED,
        image_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
        label_mode="binary",
    )
    print("Detected classes:", train_ds.class_names)

    # augmentation — helps a lot given the small dataset size
    augment = tf.keras.Sequential([
        layers.RandomFlip("horizontal"),
        layers.RandomRotation(0.08),
        layers.RandomZoom(0.1),
        layers.RandomBrightness(0.15),   # cold-storage lighting varies
        layers.RandomContrast(0.15),
    ])

    AUTOTUNE = tf.data.AUTOTUNE
    train_ds = train_ds.map(lambda x, y: (augment(x, training=True), y),
                             num_parallel_calls=AUTOTUNE).cache().prefetch(AUTOTUNE)
    val_ds = val_ds.cache().prefetch(AUTOTUNE)
    return train_ds, val_ds


def build_model():
    """MobileNetV2 backbone (pretrained on ImageNet) + small classifier head.
    alpha=0.35 keeps the model tiny — this is the smallest official
    MobileNetV2 width multiplier, which matters for ESP32-CAM's ~4MB PSRAM."""
    base = tf.keras.applications.MobileNetV2(
        input_shape=IMG_SIZE + (3,),
        include_top=False,
        weights="imagenet",
        alpha=0.35,
    )
    base.trainable = False  # freeze for initial training

    inputs = tf.keras.Input(shape=IMG_SIZE + (3,))
    x = tf.keras.applications.mobilenet_v2.preprocess_input(inputs)
    x = base(x, training=False)
    x = layers.GlobalAveragePooling2D()(x)
    x = layers.Dropout(0.3)(x)
    outputs = layers.Dense(1, activation="sigmoid")(x)  # binary: fresh vs stale

    model = models.Model(inputs, outputs)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(LEARNING_RATE),
        loss="binary_crossentropy",
        metrics=["accuracy"],
    )
    return model, base


def fine_tune(model, base, train_ds, val_ds):
    """Unfreeze the top layers of the backbone and train a bit more at a
    lower learning rate, once the classifier head has stabilized."""
    base.trainable = True
    for layer in base.layers[:-20]:
        layer.trainable = False

    model.compile(
        optimizer=tf.keras.optimizers.Adam(LEARNING_RATE / 10),
        loss="binary_crossentropy",
        metrics=["accuracy"],
    )
    model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=10,
        callbacks=[callbacks.EarlyStopping(patience=3, restore_best_weights=True)],
    )
    return model


def export_tflite(model, train_ds):
    """Exports both a float TFLite model and a full-int8 quantized model.
    The int8 version is the one you actually flash to the ESP32-CAM —
    it's roughly 4x smaller and runs much faster with no meaningful
    accuracy loss for a binary classifier like this."""
    # float version
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    tflite_model = converter.convert()
    (MODEL_DIR / "coldroot_freshness.tflite").write_bytes(tflite_model)

    # int8 quantized version, using real training images as calibration data
    def representative_dataset():
        for images, _ in train_ds.take(50):
            for img in images:
                yield [tf.expand_dims(img, 0)]

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = representative_dataset
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.int8
    converter.inference_output_type = tf.int8
    tflite_quant_model = converter.convert()
    out_path = MODEL_DIR / "coldroot_freshness_int8.tflite"
    out_path.write_bytes(tflite_quant_model)

    size_kb = len(tflite_quant_model) / 1024
    print(f"\nQuantized model saved: {out_path} ({size_kb:.1f} KB)")
    print("This is the file to convert to a C array for the ESP32-CAM build "
          "(see convert_to_c_array.py).")


def main():
    if not DATA_DIR.exists():
        raise SystemExit(
            f"Expected a '{DATA_DIR}/' folder with fresh_<crop>/ and "
            f"stale_<crop>/ subfolders. See the docstring at the top of this "
            f"file for dataset setup instructions."
        )

    train_ds, val_ds = build_datasets()
    model, base = build_model()

    print("\n--- Phase 1: training classifier head ---")
    model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=EPOCHS,
        callbacks=[callbacks.EarlyStopping(patience=4, restore_best_weights=True)],
    )

    print("\n--- Phase 2: fine-tuning top backbone layers ---")
    model = fine_tune(model, base, train_ds, val_ds)

    model.save(MODEL_DIR / "coldroot_freshness.h5")
    print(f"\nKeras model saved to {MODEL_DIR / 'coldroot_freshness.h5'}")

    export_tflite(model, train_ds)


if __name__ == "__main__":
    main()
