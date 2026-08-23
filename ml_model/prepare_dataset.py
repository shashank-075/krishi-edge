"""
ColdRoot Vision — Dataset Prep Helper
--------------------------------------
The Kaggle "Fresh and Stale Images of Fruits and Vegetables" download comes
with folders for 6 crops (apple, banana, bitter gourd, capsicum, orange,
tomato), each split fresh/stale, but the exact folder naming varies by how
you unzip it. This script walks the raw download, finds any folder whose
name contains "tomato" or "capsicum" plus "fresh" or "stale"/"rotten"/"stall",
and copies the images into the clean data/ layout train_model.py expects:

    data/fresh_tomato/    data/stale_tomato/
    data/fresh_capsicum/  data/stale_capsicum/

USAGE:
    python prepare_dataset.py /path/to/unzipped/kaggle/download
"""

import shutil
import sys
import pathlib

CROPS = ["tomato", "capsicum"]
FRESH_KEYWORDS = ["fresh"]
STALE_KEYWORDS = ["stale", "rotten", "stall"]  # dataset zips use varying spellings
IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}

OUT_DIR = pathlib.Path("data")


def classify_folder(folder_name: str):
    name = folder_name.lower()
    crop = next((c for c in CROPS if c in name), None)
    if crop is None:
        return None
    if any(k in name for k in FRESH_KEYWORDS):
        return crop, "fresh"
    if any(k in name for k in STALE_KEYWORDS):
        return crop, "stale"
    return None


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python prepare_dataset.py /path/to/unzipped/kaggle/download")

    src_root = pathlib.Path(sys.argv[1])
    if not src_root.exists():
        raise SystemExit(f"Path not found: {src_root}")

    OUT_DIR.mkdir(exist_ok=True)
    counts = {}

    for folder in [p for p in src_root.rglob("*") if p.is_dir()]:
        result = classify_folder(folder.name)
        if result is None:
            continue
        crop, label = result
        dest_dir = OUT_DIR / f"{label}_{crop}"
        dest_dir.mkdir(parents=True, exist_ok=True)

        images = [f for f in folder.iterdir() if f.suffix.lower() in IMG_EXTS]
        for img in images:
            dest = dest_dir / img.name
            if not dest.exists():
                shutil.copy2(img, dest)

        key = f"{label}_{crop}"
        counts[key] = counts.get(key, 0) + len(images)

    if not counts:
        raise SystemExit(
            "No matching folders found. Check the folder names inside your "
            "download — you may need to adjust CROPS/FRESH_KEYWORDS/"
            "STALE_KEYWORDS at the top of this script to match them."
        )

    print("Dataset prepared:")
    for key, n in sorted(counts.items()):
        print(f"  data/{key}/  -  {n} images")
    print(f"\nTotal: {sum(counts.values())} images across {len(counts)} classes")
    print("Now run: python train_model.py")


if __name__ == "__main__":
    main()
