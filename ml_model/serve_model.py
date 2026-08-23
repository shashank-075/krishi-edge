import os
import io
import time
import requests
import numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime
from contextlib import asynccontextmanager

# Check if tensorflow or tflite_runtime is available
try:
    import tensorflow as tf
    TFLITE_AVAILABLE = True
except ImportError:
    try:
        import tflite_runtime.interpreter as tflite
        tf = tflite # use tf as alias
        TFLITE_AVAILABLE = True
    except ImportError:
        TFLITE_AVAILABLE = False
        print("WARNING: Neither tensorflow nor tflite_runtime found. Will run in mock mode.")

# --- Configuration ---
MODEL_PATH_INT8 = 'models/agricold_freshness_int8.tflite'
MODEL_PATH_FLOAT = 'models/agricold_freshness.tflite'
DEFAULT_CAMERA_URL = 'http://172.21.42.57/capture'
INPUT_SHAPE = (96, 96)
CLASS_NAMES = ['fresh_apple', 'fresh_banana', 'fresh_orange', 'rotten_apple', 'rotten_banana', 'rotten_orange']

# Global state for interpreter
interpreter = None
input_details = None
output_details = None
mock_mode = False

def print_banner():
    banner = """
    ___           _    ___      _    _ 
   / _ \__ _ _ __(_)  / __\___ | |__| |
  / /_\/ _` | '__| | / /  / _ \| / _` |
 / /_\\\\ (_| | |  | |/ /__| (_) | \ (_| |
 \____/\__, |_|  |_|\____/\___/|_\__,_|
       |___/                           
    AgriCold Freshness Inference Service
    """
    print(banner)

def load_model():
    global interpreter, input_details, output_details, mock_mode, TFLITE_AVAILABLE
    
    if not TFLITE_AVAILABLE:
        print("Running in MOCK mode due to missing dependencies.")
        mock_mode = True
        return
        
    model_path = None
    if os.path.exists(MODEL_PATH_INT8):
        model_path = MODEL_PATH_INT8
    elif os.path.exists(MODEL_PATH_FLOAT):
        model_path = MODEL_PATH_FLOAT
    else:
        print(f"WARNING: Model files not found at {MODEL_PATH_INT8} or {MODEL_PATH_FLOAT}. Running in MOCK mode.")
        mock_mode = True
        return
        
    try:
        print(f"Loading TFLite model from {model_path}...")
        interpreter = tf.lite.Interpreter(model_path=model_path)
        interpreter.allocate_tensors()
        input_details = interpreter.get_input_details()
        output_details = interpreter.get_output_details()
        print(f"Model loaded successfully. Input shape: {input_details[0]['shape']}")
        mock_mode = False
    except Exception as e:
        print(f"Error loading model: {e}. Running in MOCK mode.")
        mock_mode = True

@asynccontextmanager
async def lifespan(app: FastAPI):
    print_banner()
    load_model()
    yield
    # Clean up on shutdown if needed
    print("Shutting down inference service.")

app = FastAPI(title="AgriCold ML Service", lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class PredictRequest(BaseModel):
    image_url: str = None

def preprocess_image(image: Image.Image) -> np.ndarray:
    """Preprocess image for MobileNetV2"""
    # Resize to 96x96
    image = image.resize(INPUT_SHAPE)
    # Convert to RGB if needed
    if image.mode != 'RGB':
        image = image.convert('RGB')
    
    img_array = np.array(image, dtype=np.float32)
    # Normalize to [-1, 1] for MobileNetV2
    img_array = (img_array / 127.5) - 1.0
    
    # Add batch dimension
    img_array = np.expand_dims(img_array, axis=0)
    
    # Check if we need quantization (uint8 input)
    if input_details and input_details[0]['dtype'] == np.uint8:
        # Quantize back to uint8
        # This assumes the model expects 0-255 inputs or has quantization params
        scale, zero_point = input_details[0]['quantization']
        if scale > 0:
            img_array = img_array / scale + zero_point
            img_array = np.clip(img_array, 0, 255).astype(np.uint8)
        else:
             img_array = np.clip(img_array * 127.5 + 127.5, 0, 255).astype(np.uint8)
             
    return img_array

def mock_predict():
    """Return mock prediction when model is not available"""
    scores = np.random.dirichlet(np.ones(len(CLASS_NAMES)))
    return process_prediction(scores)

def process_prediction(scores: np.ndarray):
    """Format model output scores into response dict"""
    scores = scores.flatten()
    class_idx = np.argmax(scores)
    class_name = CLASS_NAMES[class_idx]
    confidence = float(scores[class_idx])
    
    # Parse fruit and freshness from class name
    parts = class_name.split('_', 1)
    freshness = parts[0] if len(parts) > 1 else "unknown"
    fruit = parts[1] if len(parts) > 1 else class_name
    
    all_scores = {name: float(score) for name, score in zip(CLASS_NAMES, scores)}
    
    return {
        "fruit": fruit,
        "freshness": freshness,
        "class": class_name,
        "confidence": round(confidence, 4),
        "all_scores": all_scores,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

def run_inference(image_data: bytes) -> dict:
    if mock_mode:
        return mock_predict()
        
    try:
        # Load image
        img = Image.open(io.BytesIO(image_data))
        input_data = preprocess_image(img)
        
        # Run inference
        interpreter.set_tensor(input_details[0]['index'], input_data)
        interpreter.invoke()
        output_data = interpreter.get_tensor(output_details[0]['index'])
        
        # Dequantize if output is uint8
        if output_details[0]['dtype'] == np.uint8:
            scale, zero_point = output_details[0]['quantization']
            output_data = (output_data.astype(np.float32) - zero_point) * scale
            
        return process_prediction(output_data)
    except Exception as e:
        print(f"Inference error: {e}")
        raise HTTPException(status_code=500, detail=f"Inference error: {str(e)}")

@app.get("/health")
def health_check():
    status = "MOCK" if mock_mode else "LOADED"
    input_shape = input_details[0]['shape'].tolist() if input_details else list(INPUT_SHAPE)
    return {
        "status": "healthy",
        "model_status": status,
        "classes": CLASS_NAMES,
        "input_shape": input_shape
    }

@app.post("/predict")
async def predict(
    file: UploadFile = File(None),
    request: PredictRequest = Body(None)
):
    if file:
        image_data = await file.read()
    elif request and request.image_url:
        try:
            response = requests.get(request.image_url, timeout=5)
            response.raise_for_status()
            image_data = response.content
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to fetch image from URL: {e}")
    else:
        raise HTTPException(status_code=400, detail="Must provide either a file upload or a JSON body with 'image_url'")
        
    return run_inference(image_data)

@app.get("/predict/camera")
def predict_camera(ip: str = Query(None)):
    url = f"http://{ip}/capture" if ip else DEFAULT_CAMERA_URL
    try:
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        image_data = response.content
        return run_inference(image_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to capture image from camera ({url}): {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("serve_model:app", host="0.0.0.0", port=8000, reload=True)
