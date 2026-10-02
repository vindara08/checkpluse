import logging
from pathlib import Path
from typing import Any

from PIL import Image

from ultralytics import YOLO
import cv2
import numpy as np
from sklearn.cluster import KMeans
import colorsys

logger = logging.getLogger(__name__)

tk: Any
filedialog: Any
messagebox: Any
ttk: Any
ImageTk: Any
try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
    from PIL import ImageTk
except ModuleNotFoundError as exc:
    if exc.name not in {"tkinter", "_tkinter"}:
        raise
    tk = filedialog = messagebox = ttk = ImageTk = None
    GUI_IMPORT_ERROR = exc
else:
    GUI_IMPORT_ERROR = None

# ============================================================
# MODEL
# ============================================================

model = YOLO(str(Path(__file__).resolve().with_name("best.pt")))


# ============================================================
# CATEGORY MAPPING
# ============================================================

# ============================================================
# CLOTHING CATEGORY MAPPING
# ============================================================

CATEGORY_MAP = {

    # ----------------------------
    # TOPS
    # ----------------------------

    "short_sleeve_top": "Top",
    "long_sleeve_top": "Top",

    "vest": "Top",
    "sling": "Top",


    # ----------------------------
    # BOTTOMS
    # ----------------------------

    "shorts": "Bottom",
    "trousers": "Bottom",
    "skirt": "Bottom",


    # ----------------------------
    # OUTERWEAR
    # ----------------------------

    "short_sleeve_outwear": "Outerwear",
    "long_sleeve_outwear": "Outerwear",


    # ----------------------------
    # DRESSES
    # ----------------------------

    "short_sleeve_dress": "Dress",
    "long_sleeve_dress": "Dress",
    "vest_dress": "Dress",
    "sling_dress": "Dress",


    # ----------------------------
    # SHOES
    # ----------------------------

    # IMPORTANT:
    # This particular model does NOT have
    # a shoe class among its 13 classes.

}


def get_category(class_name):
    return CATEGORY_MAP.get(class_name, "Unknown")

# ============================================================
# PATTERN DETECTION
# ============================================================

def detect_pattern(image_rgb, mask):

    ys, xs = np.where(mask)

    if len(xs) == 0 or len(ys) == 0:
        return "unknown", 0.0

    x1, x2 = xs.min(), xs.max()
    y1, y2 = ys.min(), ys.max()

    crop = image_rgb[y1:y2 + 1, x1:x2 + 1]
    crop_mask = mask[y1:y2 + 1, x1:x2 + 1]

    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)

    pixels = gray[crop_mask]

    if len(pixels) < 100:
        return "unknown", 0.0

    texture_variation = np.std(pixels)

    edges = cv2.Canny(gray, 50, 150)

    masked_edges = edges[crop_mask]

    edge_density = np.mean(masked_edges > 0)

    horizontal_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        (15, 1)
    )

    vertical_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        (1, 15)
    )

    horizontal_lines = cv2.morphologyEx(
        edges,
        cv2.MORPH_OPEN,
        horizontal_kernel
    )

    vertical_lines = cv2.morphologyEx(
        edges,
        cv2.MORPH_OPEN,
        vertical_kernel
    )

    horizontal_strength = np.sum(
        horizontal_lines[crop_mask]
    )

    vertical_strength = np.sum(
        vertical_lines[crop_mask]
    )

    # Solid
    if texture_variation < 18 and edge_density < 0.08:
        return "solid", 0.80

    # Checked
    if (
        horizontal_strength > 1000
        and vertical_strength > 1000
    ):
        return "checked", 0.65

    # Horizontal / vertical stripes
    if (
        horizontal_strength > 1200
        and horizontal_strength > vertical_strength * 1.5
    ):
        return "striped", 0.65

    if (
        vertical_strength > 1200
        and vertical_strength > horizontal_strength * 1.5
    ):
        return "striped", 0.60

    # Printed
    if texture_variation > 35 or edge_density > 0.18:
        return "printed", 0.50

    return "unknown", 0.35


# ============================================================
# COLOR PALETTE
# ============================================================

COLOR_PALETTE = {
    "Black": (0, 0, 0),
    "White": (255, 255, 255),

    "Light Gray": (200, 200, 200),
    "Gray": (128, 128, 128),
    "Dark Gray": (70, 70, 70),

    "Red": (220, 30, 30),
    "Dark Red": (120, 0, 0),

    "Orange": (255, 140, 0),
    "Yellow": (255, 220, 0),

    "Green": (40, 170, 70),
    "Dark Green": (0, 90, 30),

    "Cyan": (0, 200, 200),
    "Sky Blue": (100, 180, 255),

    "Blue": (30, 80, 220),
    "Navy Blue": (0, 0, 100),

    "Purple": (140, 50, 180),
    "Pink": (240, 100, 160),

    "Brown": (150, 90, 40),
    "Dark Brown": (80, 40, 20),

    "Beige": (220, 200, 160),
}


def closest_color(rgb):

    rgb = np.array(rgb, dtype=float)

    best_name = None
    best_distance = float("inf")

    for name, color in COLOR_PALETTE.items():

        color = np.array(color, dtype=float)

        distance = np.linalg.norm(rgb - color)

        if distance < best_distance:
            best_distance = distance
            best_name = name

    return best_name


# ============================================================
# COLOR FAMILY
# ============================================================

def get_color_family(rgb):

    r, g, b = [x / 255.0 for x in rgb]

    h, s, v = colorsys.rgb_to_hsv(r, g, b)

    # Very low saturation
    if s < 0.12:

        if v < 0.15:
            return "Black"

        elif v > 0.85:
            return "White"

        else:
            return "Gray"

    hue = h * 360

    if hue < 15 or hue >= 345:
        return "Red"

    elif hue < 45:
        return "Orange"

    elif hue < 70:
        return "Yellow"

    elif hue < 160:
        return "Green"

    elif hue < 200:
        return "Cyan"

    elif hue < 250:
        return "Blue"

    elif hue < 290:
        return "Purple"

    elif hue < 345:
        return "Pink"

    return "Unknown"


# ============================================================
# BRIGHTNESS
# ============================================================

def get_brightness(rgb):

    r, g, b = rgb

    brightness = (
        0.299 * r
        + 0.587 * g
        + 0.114 * b
    )

    if brightness < 70:
        return "Dark"

    elif brightness < 170:
        return "Medium"

    else:
        return "Light"


# ============================================================
# DUPLICATE DETECTION
# ============================================================

def remove_duplicate_detections(result):

    if result.boxes is None or len(result.boxes) == 0:
        return []

    detections = []

    # --------------------------------------------
    # Collect detections
    # --------------------------------------------

    for i in range(len(result.boxes)):

        class_id = int(result.boxes.cls[i])

        confidence = float(result.boxes.conf[i])

        box = (
            result.boxes.xyxy[i]
            .cpu()
            .numpy()
        )

        x1, y1, x2, y2 = box

        area = max(0, x2 - x1) * max(0, y2 - y1)

        detections.append({
            "index": i,
            "class_id": class_id,
            "confidence": confidence,
            "box": box,
            "area": area
        })

    # --------------------------------------------
    # Highest confidence first
    # --------------------------------------------

    detections.sort(
        key=lambda x: x["confidence"],
        reverse=True
    )

    kept = []

    # --------------------------------------------
    # Compare detections
    # --------------------------------------------

    for detection in detections:

        should_remove = False

        x1, y1, x2, y2 = detection["box"]

        area = detection["area"]

        for existing in kept:

            # Only compare same clothing class
            if (
                detection["class_id"]
                != existing["class_id"]
            ):
                continue

            ex1, ey1, ex2, ey2 = existing["box"]

            existing_area = existing["area"]

            # ----------------------------------------
            # Intersection
            # ----------------------------------------

            ix1 = max(x1, ex1)
            iy1 = max(y1, ey1)

            ix2 = min(x2, ex2)
            iy2 = min(y2, ey2)

            intersection_width = max(
                0,
                ix2 - ix1
            )

            intersection_height = max(
                0,
                iy2 - iy1
            )

            intersection_area = (
                intersection_width
                * intersection_height
            )

            if area == 0 or existing_area == 0:
                continue

            # ----------------------------------------
            # Containment
            # ----------------------------------------

            containment_current = (
                intersection_area / area
            )

            containment_existing = (
                intersection_area
                / existing_area
            )

            # ----------------------------------------
            # Dimensions
            # ----------------------------------------

            current_width = x2 - x1
            current_height = y2 - y1

            existing_width = ex2 - ex1
            existing_height = ey2 - ey1

            # ----------------------------------------
            # Vertical overlap
            # ----------------------------------------

            vertical_overlap = max(
                0,
                min(y2, ey2)
                - max(y1, ey1)
            )

            smaller_height = min(
                current_height,
                existing_height
            )

            if smaller_height > 0:

                vertical_overlap_ratio = (
                    vertical_overlap
                    / smaller_height
                )

            else:

                vertical_overlap_ratio = 0

            # ----------------------------------------
            # Horizontal gap
            # ----------------------------------------

            if x2 < ex1:

                horizontal_gap = ex1 - x2

            elif ex2 < x1:

                horizontal_gap = x1 - ex2

            else:

                horizontal_gap = 0

            # ----------------------------------------
            # Duplicate rules
            # ----------------------------------------

            nested_duplicate = (
                containment_current >= 0.70
                or containment_existing >= 0.70
            )

            split_garment = (
                vertical_overlap_ratio >= 0.70
                and horizontal_gap <= 20
            )

            if (
                nested_duplicate
                or split_garment
            ):

                should_remove = True

                break

        if not should_remove:

            kept.append(detection)

    return kept


# ============================================================
# IMAGE ANALYSIS
# ============================================================

def analyze_image(image_path):

    results = model(
        image_path,
        imgsz=416,
        conf=0.5,
        agnostic_nms=True
    )

    if not results:
        return {
            "success": False,
            "message": (
                "No supported clothing detected.\n\n"
                "Please upload a clear image of clothing."
            ),
            "items": []
        }

    result = results[0]
    raw_detection_count = len(result.boxes) if result.boxes is not None else 0
    logger.info("Main 9 raw detections: %s", raw_detection_count)

    # ========================================================
    # CHECK CLOTHING DETECTION
    # ========================================================

    if (
        result.boxes is None
        or len(result.boxes) == 0
        or result.masks is None
    ):

        return {
            "success": False,
            "message": (
                "No supported clothing detected.\n\n"
                "Please upload a clear image of clothing."
            ),
            "items": []
        }

    # ========================================================
    # REMOVE DUPLICATES
    # ========================================================

    valid_detections = remove_duplicate_detections(
        result
    )
    logger.info("Main 9 detections after duplicate filtering: %s", len(valid_detections))

    if len(valid_detections) == 0:

        return {
            "success": False,
            "message": (
                "No supported clothing detected.\n\n"
                "Please upload a clear image of clothing."
            ),
            "items": []
        }

    # ========================================================
    # ORIGINAL IMAGE
    # ========================================================

    image = cv2.imread(image_path)

    if image is None:

        return {
            "success": False,
            "message": "Could not read the selected image.",
            "items": []
        }

    image_rgb = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2RGB
    )

    image_height, image_width = image_rgb.shape[:2]

    items = []

    # ========================================================
    # PROCESS EACH CLOTHING ITEM
    # ========================================================

    for detection in valid_detections:

        i = detection["index"]

        class_id = detection["class_id"]

        class_name = result.names[class_id]

        # ----------------------------------------------------
        # CATEGORY
        # ----------------------------------------------------

        category = get_category(class_name)

        # ----------------------------------------------------
        # MASK
        # ----------------------------------------------------

        mask = result.masks.data[i]

        mask = mask.cpu().numpy()

        mask = cv2.resize(
            mask,
            (
                image_width,
                image_height
            )
        )

        mask = mask > 0.5

        clothing_pixels = image_rgb[mask]

        if len(clothing_pixels) == 0:

            continue

        # ----------------------------------------------------
        # Limit pixels for KMeans
        # ----------------------------------------------------

        if len(clothing_pixels) > 5000:

            random_indices = np.random.choice(
                len(clothing_pixels),
                5000,
                replace=False
            )

            clothing_pixels_for_kmeans = (
                clothing_pixels[random_indices]
            )

        else:

            clothing_pixels_for_kmeans = clothing_pixels

        # ----------------------------------------------------
        # KMEANS COLOR EXTRACTION
        # ----------------------------------------------------

        if len(clothing_pixels_for_kmeans) >= 3:

            kmeans = KMeans(
                n_clusters=3,
                random_state=42,
                n_init=10
            )

            labels = kmeans.fit_predict(
                clothing_pixels_for_kmeans
            )

            centers = kmeans.cluster_centers_

            counts = np.bincount(labels)

            sorted_indices = np.argsort(
                counts
            )[::-1]

            dominant_index = sorted_indices[0]

            dominant_rgb = (
                centers[dominant_index]
                .astype(int)
            )

            dominant_percentage = (
                counts[dominant_index]
                / len(labels)
                * 100
            )

            # ------------------------------------------------
            # SECONDARY COLOR
            # ------------------------------------------------

            if len(sorted_indices) > 1:

                secondary_index = sorted_indices[1]

                secondary_percentage = (
                    counts[secondary_index]
                    / len(labels)
                    * 100
                )

                # Only report meaningful secondary colors
                if secondary_percentage >= 5:

                    secondary_rgb = (
                        centers[secondary_index]
                        .astype(int)
                    )

                    secondary_color = closest_color(
                        secondary_rgb
                    )

                else:

                    secondary_color = None
                    secondary_percentage = 0

            else:

                secondary_color = None
                secondary_percentage = 0

        else:

            dominant_rgb = np.mean(
                clothing_pixels,
                axis=0
            ).astype(int)

            dominant_percentage = 100

            secondary_color = None
            secondary_percentage = 0

        # ----------------------------------------------------
        # COLOR INFORMATION
        # ----------------------------------------------------

        dominant_color = closest_color(
            dominant_rgb
        )

        color_family = get_color_family(
            dominant_rgb
        )

        brightness = get_brightness(
            dominant_rgb
        )

        # ----------------------------------------------------
        # PATTERN
        # ----------------------------------------------------

        pattern, _ = detect_pattern(
            image_rgb,
            mask
        )

        # ----------------------------------------------------
        # FINAL ITEM
        # ----------------------------------------------------

        item = {

            "detection_index": i,

            "clothing_type": class_name,

            "category": category,

            "pattern": pattern,

            "dominant_color": dominant_color,

            "dominant_rgb": tuple(
                int(x)
                for x in dominant_rgb
            ),

            "dominant_percentage": (
                dominant_percentage
            ),

            "secondary_color": secondary_color,

            "secondary_percentage": (
                secondary_percentage
            ),

            "color_family": color_family,

            "brightness": brightness
        }

        items.append(item)

    logger.info(
        "Main 9 processed %s of %s duplicate-filtered clothing detections",
        len(items),
        len(valid_detections),
    )

    # ========================================================
    # FINAL RESULT
    # ========================================================

    if len(items) == 0:

        return {
            "success": False,
            "message": (
                "No valid clothing item could be analyzed."
            ),
            "items": []
        }

    return {
        "success": True,
        "message": "Clothing detected successfully.",
        "items": items
    }


# ============================================================
# TKINTER APPLICATION
# ============================================================

class ClothingAnalyzerApp:

    def __init__(self, root):

        self.root = root

        self.root.title(
            "Digital Wardrobe - Clothing Analyzer"
        )

        self.root.geometry(
            "1100x750"
        )

        self.root.minsize(
            900,
            650
        )

        self.image_path = None

        self.preview_image = None

        self.last_result = None

        # ====================================================
        # TITLE
        # ====================================================

        title = tk.Label(
            root,
            text="Digital Wardrobe Clothing Analyzer",
            font=("Arial", 22, "bold")
        )

        title.pack(
            pady=(15, 5)
        )

        subtitle = tk.Label(
            root,
            text=(
                "AI clothing detection + colors + "
                "pattern + category"
            ),
            font=("Arial", 11)
        )

        subtitle.pack(
            pady=(0, 15)
        )

        # ====================================================
        # MAIN FRAME
        # ====================================================

        main_frame = tk.Frame(root)

        main_frame.pack(
            fill="both",
            expand=True,
            padx=15,
            pady=10
        )

        # ====================================================
        # LEFT SIDE
        # ====================================================

        left_frame = tk.Frame(
            main_frame,
            width=500
        )

        left_frame.pack(
            side="left",
            fill="both",
            expand=True,
            padx=(0, 10)
        )

        # ----------------------------------------------------
        # IMAGE PREVIEW
        # ----------------------------------------------------

        self.image_label = tk.Label(
            left_frame,
            text="No image selected",
            relief="solid",
            borderwidth=1
        )

        self.image_label.pack(
            fill="both",
            expand=True,
            pady=(0, 10)
        )

        # ----------------------------------------------------
        # BUTTONS
        # ----------------------------------------------------

        button_frame = tk.Frame(
            left_frame
        )

        button_frame.pack(
            fill="x",
            pady=5
        )

        upload_button = tk.Button(
            button_frame,
            text="Upload Image",
            command=self.upload_image,
            font=("Arial", 11, "bold"),
            padx=15,
            pady=8
        )

        upload_button.pack(
            side="left",
            padx=5
        )

        analyze_button = tk.Button(
            button_frame,
            text="Analyze Image",
            command=self.analyze,
            font=("Arial", 11, "bold"),
            padx=15,
            pady=8
        )

        analyze_button.pack(
            side="left",
            padx=5
        )

        clear_button = tk.Button(
            button_frame,
            text="Clear",
            command=self.clear,
            font=("Arial", 11),
            padx=15,
            pady=8
        )

        clear_button.pack(
            side="left",
            padx=5
        )

        # ====================================================
        # RIGHT SIDE
        # ====================================================

        right_frame = tk.Frame(
            main_frame,
            width=500
        )

        right_frame.pack(
            side="right",
            fill="both",
            expand=True,
            padx=(10, 0)
        )

        # ====================================================
        # MANUAL INFORMATION
        # ====================================================

        manual_title = tk.Label(
            right_frame,
            text="Manual Information",
            font=("Arial", 15, "bold")
        )

        manual_title.pack(
            anchor="w",
            pady=(0, 10)
        )

        # ----------------------------------------------------
        # FORMALITY
        # ----------------------------------------------------

        formality_frame = tk.Frame(
            right_frame
        )

        formality_frame.pack(
            fill="x",
            pady=5
        )

        tk.Label(
            formality_frame,
            text="Formality:",
            font=("Arial", 11)
        ).pack(
            side="left"
        )

        self.formality_var = tk.StringVar(
            value="Casual / Informal"
        )

        formality_dropdown = ttk.Combobox(
            formality_frame,
            textvariable=self.formality_var,
            values=[
                "Casual / Informal",
                "Smart Casual",
                "Formal"
            ],
            state="readonly"
        )

        formality_dropdown.pack(
            side="right",
            fill="x",
            expand=True,
            padx=(10, 0)
        )

        # ----------------------------------------------------
        # SEASON
        # ----------------------------------------------------

        season_frame = tk.Frame(
            right_frame
        )

        season_frame.pack(
            fill="x",
            pady=5
        )

        tk.Label(
            season_frame,
            text="Season:",
            font=("Arial", 11)
        ).pack(
            side="left"
        )

        self.season_var = tk.StringVar(
            value="All Season"
        )

        season_dropdown = ttk.Combobox(
            season_frame,
            textvariable=self.season_var,
            values=[
                "Summer",
                "Winter",
                "Monsoon",
                "All Season"
            ],
            state="readonly"
        )

        season_dropdown.pack(
            side="right",
            fill="x",
            expand=True,
            padx=(10, 0)
        )

        # ----------------------------------------------------
        # OCCASION
        # ----------------------------------------------------

        occasion_frame = tk.Frame(
            right_frame
        )

        occasion_frame.pack(
            fill="x",
            pady=5
        )

        tk.Label(
            occasion_frame,
            text="Occasion:",
            font=("Arial", 11)
        ).pack(
            side="left"
        )

        self.occasion_var = tk.StringVar(
            value="Daily Wear"
        )

        occasion_dropdown = ttk.Combobox(
            occasion_frame,
            textvariable=self.occasion_var,
            values=[
                "Daily Wear",
                "College",
                "Office",
                "Party",
                "Travel",
                "Sports",
                "Wedding / Traditional",
                "Other"
            ],
            state="readonly"
        )

        occasion_dropdown.pack(
            side="right",
            fill="x",
            expand=True,
            padx=(10, 0)
        )

        # ====================================================
        # RESULT AREA
        # ====================================================

        result_title = tk.Label(
            right_frame,
            text="Analysis Result",
            font=("Arial", 15, "bold")
        )

        result_title.pack(
            anchor="w",
            pady=(20, 8)
        )

        result_container = tk.Frame(
            right_frame
        )

        result_container.pack(
            fill="both",
            expand=True
        )

        scrollbar = tk.Scrollbar(
            result_container
        )

        scrollbar.pack(
            side="right",
            fill="y"
        )

        self.result_text = tk.Text(
            result_container,
            wrap="word",
            font=("Consolas", 10),
            yscrollcommand=scrollbar.set
        )

        self.result_text.pack(
            side="left",
            fill="both",
            expand=True
        )

        scrollbar.config(
            command=self.result_text.yview
        )

    # ========================================================
    # UPLOAD IMAGE
    # ========================================================

    def upload_image(self):

        path = filedialog.askopenfilename(
            title="Select Clothing Image",
            filetypes=[
                (
                    "Image Files",
                    "*.jpg *.jpeg *.png *.webp"
                )
            ]
        )

        if not path:
            return

        self.image_path = path

        try:

            image = Image.open(
                path
            )

            image.thumbnail(
                (480, 480)
            )

            self.preview_image = ImageTk.PhotoImage(
                image
            )

            self.image_label.config(
                image=self.preview_image,
                text=""
            )

            self.result_text.delete(
                "1.0",
                tk.END
            )

            self.result_text.insert(
                tk.END,
                "Image selected.\n\n"
                "Click 'Analyze Image' to start."
            )

        except Exception as e:

            messagebox.showerror(
                "Error",
                f"Could not open image:\n{e}"
            )

    # ========================================================
    # ANALYZE
    # ========================================================

    def analyze(self):

        if not self.image_path:

            messagebox.showwarning(
                "No Image",
                "Please upload an image first."
            )

            return

        self.result_text.delete(
            "1.0",
            tk.END
        )

        self.result_text.insert(
            tk.END,
            "Analyzing image...\n\n"
        )

        self.root.update_idletasks()

        try:

            result = analyze_image(
                self.image_path
            )

            self.last_result = result

            # ------------------------------------------------
            # FAILURE
            # ------------------------------------------------

            if not result["success"]:

                self.result_text.delete(
                    "1.0",
                    tk.END
                )

                self.result_text.insert(
                    tk.END,
                    "❌ INVALID IMAGE\n"
                    "=============================================\n\n"
                )

                self.result_text.insert(
                    tk.END,
                    result["message"]
                )

                return

            # ------------------------------------------------
            # SUCCESS
            # ------------------------------------------------

            self.result_text.delete(
                "1.0",
                tk.END
            )

            self.result_text.insert(
                tk.END,
                "✅ CLOTHING DETECTED\n"
                "=============================================\n\n"
            )

            # ------------------------------------------------
            # MANUAL INFORMATION
            # ------------------------------------------------

            self.result_text.insert(
                tk.END,
                "MANUAL INFORMATION\n"
                "------------------------------\n"
            )

            self.result_text.insert(
                tk.END,
                f"Formality: "
                f"{self.formality_var.get()}\n"
            )

            self.result_text.insert(
                tk.END,
                f"Season: "
                f"{self.season_var.get()}\n"
            )

            self.result_text.insert(
                tk.END,
                f"Occasion: "
                f"{self.occasion_var.get()}\n\n"
            )

            # ------------------------------------------------
            # ITEMS
            # ------------------------------------------------

            for index, item in enumerate(
                result["items"],
                start=1
            ):

                self.result_text.insert(
                    tk.END,
                    f"ITEM {index}\n"
                    "------------------------------\n"
                )

                self.result_text.insert(
                    tk.END,
                    f"Clothing: "
                    f"{item['clothing_type']}\n"
                )

                self.result_text.insert(
                    tk.END,
                    f"Category: "
                    f"{item['category']}\n"
                )

                self.result_text.insert(
                    tk.END,
                    f"Pattern: "
                    f"{item['pattern']}\n"
                )

                self.result_text.insert(
                    tk.END,
                    f"Dominant color: "
                    f"{item['dominant_color']}\n"
                )

                self.result_text.insert(
                    tk.END,
                    f"Color family: "
                    f"{item['color_family']}\n"
                )

                self.result_text.insert(
                    tk.END,
                    f"Brightness: "
                    f"{item['brightness']}\n"
                )

                self.result_text.insert(
                    tk.END,
                    f"Dominant RGB: "
                    f"{item['dominant_rgb']}\n"
                )

                self.result_text.insert(
                    tk.END,
                    f"Dominant percentage: "
                    f"{item['dominant_percentage']:.1f}%\n\n"
                )

                self.result_text.insert(
                    tk.END,
                    f"Secondary color: "
                    f"{item['secondary_color']}\n"
                )

                if item["secondary_color"]:

                    self.result_text.insert(
                        tk.END,
                        f"Secondary percentage: "
                        f"{item['secondary_percentage']:.1f}%\n"
                    )

                self.result_text.insert(
                    tk.END,
                    "\n=============================================\n\n"
                )

        except Exception as e:

            self.result_text.delete(
                "1.0",
                tk.END
            )

            self.result_text.insert(
                tk.END,
                "❌ ERROR\n"
                "=============================================\n\n"
            )

            self.result_text.insert(
                tk.END,
                str(e)
            )

            messagebox.showerror(
                "Analysis Error",
                str(e)
            )

    # ========================================================
    # CLEAR
    # ========================================================

    def clear(self):

        self.image_path = None

        self.preview_image = None

        self.last_result = None

        self.image_label.config(
            image="",
            text="No image selected"
        )

        self.result_text.delete(
            "1.0",
            tk.END
        )

        self.formality_var.set(
            "Casual / Informal"
        )

        self.season_var.set(
            "All Season"
        )

        self.occasion_var.set(
            "Daily Wear"
        )


# ============================================================
# RUN APPLICATION
# ============================================================

if __name__ == "__main__":

    if GUI_IMPORT_ERROR is not None:
        raise RuntimeError("Tkinter is required only to launch Main 9's desktop GUI.") from GUI_IMPORT_ERROR

    root = tk.Tk()

    app = ClothingAnalyzerApp(
        root
    )

    root.mainloop()