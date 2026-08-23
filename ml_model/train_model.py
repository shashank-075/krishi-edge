"""
AgriCold Vision — Freshness Classifier Training Script
--------------------------------------------------------
Trains a lightweight MobileNetV2-based classifier on the Kaggle
"Fruit Freshness Dataset v1", then exports an int8-quantized TFLite 
model small enough to run on an ESP32-CAM via TensorFlow Lite for 
Microcontrollers.

USAGE:
    1. Download the dataset from:
       https://www.kaggle.com/datasets/user2036/fruit-freshness-dataset-v1
    2. Unzip it and run `python prepare_dataset.py /path/to/unzipped/dataset`
    3. pip install -r requirements.txt
    4. python train_model.py

OUTPUT:
    models/agricold_freshness.h5          - full Keras model
    models/agricold_freshness.tflite      - float TFLite model
    models/agricold_freshness_int8.tflite - quantized model for ESP32-CAM
"""

import os
import pathlib
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models, callbacks
from sklearn.metrics import classification_report, confusion_matrix
import matplotlib.pyplot as plt

# ----------------------------- config -----------------------------
DATA_DIR = pathlib.Path("data")
MODEL_DIR = pathlib.Path("models")
MODEL_DIR.mkdir(exist_ok=True)

IMG_SIZE = (96, 96)      # small on purpose — ESP32-CAM has very limited RAM
BATCH_SIZE = 16
EPOCHS = 25
LEARNING_RATE = 1e-4
SEED = 42

CLASS_NAMES = [
    'fresh_apple', 'fresh_banana', 'fresh_orange', 
    'rotten_apple', 'rotten_banana', 'rotten_orange'
]
NUM_CLASSES = len(CLASS_NAMES)


def build_datasets():
    """Loads images from data/train and data/test folders."""
    train_dir = DATA_DIR / "train"
    test_dir = DATA_DIR / "test"
    
    train_ds = tf.keras.utils.image_dataset_from_directory(
        train_dir,
        seed=SEED,
        image_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
        label_mode="int",
        class_names=CLASS_NAMES,
    )
    val_ds = tf.keras.utils.image_dataset_from_directory(
        test_dir,
        seed=SEED,
        image_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
        label_mode="int",
        class_names=CLASS_NAMES,
        shuffle=False, # Important for classification report later
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
    outputs = layers.Dense(NUM_CLASSES, activation="softmax")(x)

    model = models.Model(inputs, outputs)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(LEARNING_RATE),
        loss="sparse_categorical_crossentropy",
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
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=10,
        callbacks=[callbacks.EarlyStopping(patience=3, restore_best_weights=True)],
    )
    return model


def evaluate_model(model, val_ds):
    """Evaluates the model and prints classification report and confusion matrix."""
    print("\n--- Evaluating Model ---")
    
    y_true = []
    y_pred = []
    
    for images, labels in val_ds:
        preds = model.predict(images, verbose=0)
        y_pred.extend(np.argmax(preds, axis=1))
        y_true.extend(labels.numpy())
        
    y_true = np.array(y_true)
    y_pred = np.array(y_pred)
    
    print("\nClassification Report:")
    print(classification_report(y_true, y_pred, target_names=CLASS_NAMES))
    
    cm = confusion_matrix(y_true, y_pred)
    
    fig, ax = plt.subplots(figsize=(8, 8))
    cax = ax.matshow(cm, cmap=plt.cm.Blues)
    fig.colorbar(cax)
    
    ax.set_xticks(np.arange(NUM_CLASSES))
    ax.set_yticks(np.arange(NUM_CLASSES))
    ax.set_xticklabels(CLASS_NAMES, rotation=45, ha='left')
    ax.set_yticklabels(CLASS_NAMES)
    
    plt.xlabel('Predicted')
    plt.ylabel('True')
    
    for i in range(NUM_CLASSES):
        for j in range(NUM_CLASSES):
            ax.text(j, i, str(cm[i, j]), va='center', ha='center')
            
    plt.title('Confusion Matrix')
    plt.tight_layout()
    plt.savefig('confusion_matrix.png')
    print("Saved confusion matrix plot to confusion_matrix.png")


def export_tflite(model, train_ds):
    """Exports both a float TFLite model and a full-int8 quantized model.
    The int8 version is the one you actually flash to the ESP32-CAM —
    it's roughly 4x smaller and runs much faster."""
    # float version
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    tflite_model = converter.convert()
    (MODEL_DIR / "agricold_freshness.tflite").write_bytes(tflite_model)

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
    out_path = MODEL_DIR / "agricold_freshness_int8.tflite"
    out_path.write_bytes(tflite_quant_model)

    size_kb = len(tflite_quant_model) / 1024
    print(f"\nQuantized model saved: {out_path} ({size_kb:.1f} KB)")
    print("This is the file to convert to a C array for the ESP32-CAM build "
          "(see convert_to_c_array.py).")


def main():
    if not (DATA_DIR / "train").exists():
        raise SystemExit(
            f"Expected a '{DATA_DIR}/train' folder. See the docstring at the top of this "
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

    model.save(MODEL_DIR / "agricold_freshness.h5")
    print(f"\nKeras model saved to {MODEL_DIR / 'agricold_freshness.h5'}")
    
    evaluate_model(model, val_ds)
    export_tflite(model, train_ds)


if __name__ == "__main__":
    main()
