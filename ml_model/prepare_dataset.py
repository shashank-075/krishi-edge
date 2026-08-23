"""
AgriCold Vision — Dataset Prep Helper
--------------------------------------
The Kaggle "Fruit Freshness Dataset v1" download comes with a train/ and test/
split, each containing folders for apple, banana, orange (fresh), and 
rottenapples, rottenbanana, rottenoranges.

This script copies the images into a cleaner data/ layout that train_model.py expects:

    data/train/fresh_apple/    data/train/rotten_apple/
    data/train/fresh_banana/   data/train/rotten_banana/
    data/train/fresh_orange/   data/train/rotten_orange/
    
    data/test/fresh_apple/     data/test/rotten_apple/
    data/test/fresh_banana/    data/test/rotten_banana/
    data/test/fresh_orange/    data/test/rotten_orange/

USAGE:
    python prepare_dataset.py /path/to/unzipped/kaggle/download
"""

import shutil
import sys
import pathlib

# Mapping Kaggle's folder names to our clean class names
FOLDER_MAP = {
    "apple": "fresh_apple",
    "banana": "fresh_banana",
    "orange": "fresh_orange",
    "rottenapples": "rotten_apple",
    "rottenbanana": "rotten_banana",
    "rottenoranges": "rotten_orange",
}

IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}
OUT_DIR = pathlib.Path("data")

def process_split(src_root: pathlib.Path, split: str, counts: dict):
    split_dir = src_root / split
    if not split_dir.exists():
        print(f"Warning: {split} directory not found in {src_root}")
        return

    for folder in split_dir.iterdir():
        if not folder.is_dir():
            continue
            
        folder_name = folder.name.lower()
        if folder_name not in FOLDER_MAP:
            continue
            
        clean_name = FOLDER_MAP[folder_name]
        dest_dir = OUT_DIR / split / clean_name
        dest_dir.mkdir(parents=True, exist_ok=True)
        
        images = [f for f in folder.iterdir() if f.suffix.lower() in IMG_EXTS]
        for img in images:
            dest = dest_dir / img.name
            if not dest.exists():
                shutil.copy2(img, dest)
                
        key = f"{split}/{clean_name}"
        counts[key] = counts.get(key, 0) + len(images)

def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python prepare_dataset.py /path/to/unzipped/kaggle/download")

    src_root = pathlib.Path(sys.argv[1])
    if not src_root.exists():
        raise SystemExit(f"Path not found: {src_root}")

    OUT_DIR.mkdir(exist_ok=True)
    counts = {}

    process_split(src_root, "train", counts)
    process_split(src_root, "test", counts)

    if not counts:
        raise SystemExit(
            "No matching folders found. Check the folder structure inside your "
            "download — it should contain train/ and test/ directories."
        )

    print("Dataset prepared:")
    for key, n in sorted(counts.items()):
        print(f"  data/{key}/  -  {n} images")
    print(f"\nTotal: {sum(counts.values())} images")
    print("Now run: python train_model.py")

if __name__ == "__main__":
    main()
