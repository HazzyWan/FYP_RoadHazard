import os
import base64
import datetime
import uuid
import json
import ast
import re
import hmac
import hashlib
import random
import shutil
import sys
import threading
import subprocess
import concurrent.futures
import tempfile
import zipfile
import html
import smtplib
from email.message import EmailMessage
from pathlib import Path

from flask import Flask, jsonify, request, session, send_file
from flask_cors import CORS
from PIL import Image, ImageOps
from PIL.ExifTags import TAGS, GPSTAGS
import firebase_admin
from firebase_admin import credentials, firestore, storage
try:
    from google.cloud import storage as gcs_storage
except Exception:
    gcs_storage = None
import numpy as np
import cv2
from ultralytics import YOLO
import urllib.parse
import urllib.request

import google.auth
from google.auth.transport.requests import Request as GoogleAuthRequest

app = Flask(__name__)
CORS(app, supports_credentials=True)
app.config['SESSION_COOKIE_NAME'] = os.getenv('SESSION_COOKIE_NAME', '__session').strip() or '__session'
app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY', 'roadhazard-dev-session-key')
app.config['SESSION_COOKIE_SECURE'] = os.getenv('SESSION_COOKIE_SECURE', 'false').lower() == 'true'
app.config['SESSION_COOKIE_SAMESITE'] = os.getenv('SESSION_COOKIE_SAMESITE', 'Lax')

PUBLIC_BASE_URL = os.getenv('PUBLIC_BASE_URL', '').strip()
DEFAULT_CONTRACTOR_EMAIL = os.getenv('DEFAULT_CONTRACTOR_EMAIL', 'roadhazard.contractor@gmail.com').strip().lower()
ADMIN_LOGIN_EMAIL = os.getenv('ADMIN_LOGIN_EMAIL', 'admin@roadhazard.local').strip().lower()
ADMIN_LOGIN_PASSWORD = os.getenv('ADMIN_LOGIN_PASSWORD', '')  # empty disables admin login
AUTO_REPAIR_EMAIL_ENABLED = os.getenv('AUTO_REPAIR_EMAIL_ENABLED', 'false').strip().lower() == 'true'
REPORTER_UPDATE_EMAIL_ENABLED = os.getenv('REPORTER_UPDATE_EMAIL_ENABLED', 'true').strip().lower() == 'true'
SMTP_HOST = os.getenv('SMTP_HOST', 'smtp.gmail.com').strip()
SMTP_PORT = int(os.getenv('SMTP_PORT', '587') or 587)
SMTP_USE_TLS = os.getenv('SMTP_USE_TLS', 'true').strip().lower() == 'true'
SMTP_USERNAME = os.getenv('SMTP_USERNAME', '').strip()
SMTP_PASSWORD = os.getenv('SMTP_PASSWORD', '').strip()
SMTP_FROM = os.getenv('SMTP_FROM', SMTP_USERNAME or DEFAULT_CONTRACTOR_EMAIL).strip() or (SMTP_USERNAME or DEFAULT_CONTRACTOR_EMAIL)
RUNTIME_SERVICE_ACCOUNT_EMAIL = os.getenv('RUNTIME_SERVICE_ACCOUNT_EMAIL', '').strip()


def _is_admin_authenticated():
    return bool(session.get('is_admin'))


def _require_admin_auth():
    if _is_admin_authenticated():
        return None
    return jsonify({"error": "Unauthorized. Please login as admin."}), 401


def _get_runtime_service_account_email():
    if RUNTIME_SERVICE_ACCOUNT_EMAIL:
        return RUNTIME_SERVICE_ACCOUNT_EMAIL

    metadata_url = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email'
    request = urllib.request.Request(metadata_url, headers={'Metadata-Flavor': 'Google'})
    try:
        with urllib.request.urlopen(request, timeout=2) as response:
            return response.read().decode('utf-8').strip()
    except Exception:
        return ''


def _get_runtime_access_token():
    try:
        credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
        credentials.refresh(GoogleAuthRequest())
        return getattr(credentials, 'token', '') or ''
    except Exception:
        return ''


REPORTER_TOKEN_SECRET = os.getenv('REPORTER_TOKEN_SECRET', 'roadhazard-reporter-secret')


@app.before_request
def _handle_cors_preflight():
    # Browsers send an unauthenticated OPTIONS preflight for cross-origin POSTs.
    # Return 204 early so the actual authenticated request can proceed.
    if request.method == 'OPTIONS':
        return ('', 204)
    return None

def _reporter_signature(reporter_id: str):
    reporter_key = (reporter_id or '').strip()
    if not reporter_key:
        return ''
    return hmac.new(
        REPORTER_TOKEN_SECRET.encode('utf-8'),
        reporter_key.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

def _issue_reporter_identity(reporter_id: str | None = None):
    rid = (reporter_id or '').strip() or uuid.uuid4().hex
    signature = _reporter_signature(rid)
    return {
        'reporterId': rid,
        'reporterToken': f"{rid}.{signature}"
    }

def _verify_reporter_token(reporter_token: str):
    token = (reporter_token or '').strip()
    if not token or '.' not in token:
        return None

    reporter_id, signature = token.split('.', 1)
    reporter_id = (reporter_id or '').strip()
    signature = (signature or '').strip().lower()
    if not reporter_id or not signature:
        return None

    expected = _reporter_signature(reporter_id)
    if not expected:
        return None
    if not hmac.compare_digest(signature, expected):
        return None
    return reporter_id

def _resolve_default_model_path():
    env_model_path = os.getenv('MODEL_PATH')
    if env_model_path:
        return env_model_path

    detect_root = Path(__file__).resolve().parent.parent / 'runs' / 'detect'
    if detect_root.exists():
        candidates = sorted(
            detect_root.glob('road_hazards_multi*/weights/best.pt'),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if candidates:
            return str(candidates[0])

    return '../runs/detect/road_hazards_multi/weights/best.pt'

MODEL_PATH = _resolve_default_model_path()
FIREBASE_STORAGE_BUCKET = os.getenv('FIREBASE_STORAGE_BUCKET', 'roadhazard-fyp.firebasestorage.app')
model = None
model_load_error = None
_model_loaded_mtime = None
_model_loaded_path = None

# Inference tuning via environment variables
def _parse_classes_env(val: str | None):
    """Parse comma-separated class ids (e.g., "0,1") into a list[int], or None."""
    if not val:
        return None
    try:
        return [int(x.strip()) for x in val.split(',') if x.strip() != '']
    except Exception:
        return None

def _parse_class_conf_env(val: str | None):
    """Parse class confidence map from env safely (JSON or Python dict-like)."""
    if not val or not str(val).strip():
        return {}

    raw = str(val).strip()
    candidates = [raw]
    if raw.startswith("'") and raw.endswith("'"):
        candidates.append(raw[1:-1])

    for candidate in candidates:
        relaxed = re.sub(r'([\{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)', r'\1"\2"\3', candidate)
        parse_candidates = [candidate]
        if relaxed != candidate:
            parse_candidates.append(relaxed)

        for to_parse in parse_candidates:
            try:
                parsed = json.loads(to_parse)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                pass

        try:
            parsed = ast.literal_eval(candidate)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

        try:
            parsed = ast.literal_eval(relaxed)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

    print(f"Warning: invalid INFER_CLASS_CONF value '{raw}', falling back to {{}}")
    return {}

INFER_CONF = float(os.getenv('INFER_CONF', '0.25'))
INFER_IOU = float(os.getenv('INFER_IOU', '0.45'))
INFER_CLASSES = _parse_classes_env(os.getenv('INFER_CLASSES'))  # e.g., "1" to test cracks only
INFER_CLASS_CONF = _parse_class_conf_env(os.getenv('INFER_CLASS_CONF'))
INFER_ENABLE_SECOND_PASS = os.getenv('INFER_ENABLE_SECOND_PASS', 'true').strip().lower() in {'1', 'true', 'yes', 'on'}
INFER_SECOND_PASS_CONF = float(os.getenv('INFER_SECOND_PASS_CONF', '0.18'))
INFER_SECOND_PASS_CLAHE = os.getenv('INFER_SECOND_PASS_CLAHE', 'true').strip().lower() in {'1', 'true', 'yes', 'on'}
INFER_CRACK_SUBTYPE_MIN_CONF = float(os.getenv('INFER_CRACK_SUBTYPE_MIN_CONF', '0.66'))
INFER_ROAD_AXIS = os.getenv('INFER_ROAD_AXIS', 'vertical').strip().lower() or 'vertical'
INFER_POTHOLE_RECHECK = os.getenv('INFER_POTHOLE_RECHECK', 'true').strip().lower() in {'1', 'true', 'yes', 'on'}
INFER_POTHOLE_RECLASSIFY_MIN_CRACK_CONF = float(os.getenv('INFER_POTHOLE_RECLASSIFY_MIN_CRACK_CONF', '0.62'))
INFER_POTHOLE_RECLASSIFY_MAX_MARGIN = float(os.getenv('INFER_POTHOLE_RECLASSIFY_MAX_MARGIN', '0.20'))
INFER_POTHOLE_RECLASSIFY_LINEAR_MIN_ADVANTAGE = float(os.getenv('INFER_POTHOLE_RECLASSIFY_LINEAR_MIN_ADVANTAGE', '0.05'))
INFER_POTHOLE_RECLASSIFY_LINEAR_MIN_CRACK_CONF = float(os.getenv('INFER_POTHOLE_RECLASSIFY_LINEAR_MIN_CRACK_CONF', '0.74'))
INFER_POTHOLE_LOCK_CONF = float(os.getenv('INFER_POTHOLE_LOCK_CONF', '0.92'))
INFER_POTHOLE_LINEAR_MAX_BASE_CONF = float(os.getenv('INFER_POTHOLE_LINEAR_MAX_BASE_CONF', '0.72'))
INFER_POTHOLE_LINEAR_MIN_ASPECT = float(os.getenv('INFER_POTHOLE_LINEAR_MIN_ASPECT', '1.80'))
INFER_REMAP_OTHER_TO_CRACK = os.getenv('INFER_REMAP_OTHER_TO_CRACK', 'true').strip().lower() in {'1', 'true', 'yes', 'on'}
INFER_SHADOW_GUARD_ENABLED = os.getenv('INFER_SHADOW_GUARD_ENABLED', 'false').strip().lower() in {'1', 'true', 'yes', 'on'}
INFER_SHADOW_GUARD_ALLIGATOR_MIN_CONF = float(os.getenv('INFER_SHADOW_GUARD_ALLIGATOR_MIN_CONF', '0.70'))
INFER_SHADOW_GUARD_DARK_RATIO = float(os.getenv('INFER_SHADOW_GUARD_DARK_RATIO', '0.34'))
INFER_SHADOW_GUARD_LARGEST_COMPONENT_RATIO = float(os.getenv('INFER_SHADOW_GUARD_LARGEST_COMPONENT_RATIO', '0.18'))
INFER_CRACK_BBOX_REFINEMENT_ENABLED = os.getenv('INFER_CRACK_BBOX_REFINEMENT_ENABLED', 'false').strip().lower() in {'1', 'true', 'yes', 'on'}
INFER_CRACK_BBOX_REFINEMENT_MIN_AREA_RATIO = float(os.getenv('INFER_CRACK_BBOX_REFINEMENT_MIN_AREA_RATIO', '0.05'))
INFER_CRACK_BBOX_REFINEMENT_MAX_AREA_RATIO = float(os.getenv('INFER_CRACK_BBOX_REFINEMENT_MAX_AREA_RATIO', '0.88'))
INFER_CRACK_RELOCALIZE_ENABLED = os.getenv('INFER_CRACK_RELOCALIZE_ENABLED', 'true').strip().lower() in {'1', 'true', 'yes', 'on'}
INFER_CRACK_RELOCALIZE_MIN_IMAGE_AREA = float(os.getenv('INFER_CRACK_RELOCALIZE_MIN_IMAGE_AREA', '0.28'))
INFER_CRACK_RELOCALIZE_MAX_AREA_RATIO = float(os.getenv('INFER_CRACK_RELOCALIZE_MAX_AREA_RATIO', '0.75'))
INFER_CRACK_RELOCALIZE_CONF = float(os.getenv('INFER_CRACK_RELOCALIZE_CONF', '0.16'))
INFER_FEEDBACK_GUIDANCE_ENABLED = os.getenv('INFER_FEEDBACK_GUIDANCE_ENABLED', 'true').strip().lower() in {'1', 'true', 'yes', 'on'}
SCENARIO_CONSENSUS_MIN_MARGIN = float(os.getenv('SCENARIO_CONSENSUS_MIN_MARGIN', '0.18'))
SCENARIO_CONSENSUS_MIN_SCORE = float(os.getenv('SCENARIO_CONSENSUS_MIN_SCORE', '0.56'))
SCENARIO_ORIGINAL_WEIGHT = float(os.getenv('SCENARIO_ORIGINAL_WEIGHT', '1.10'))

HAZARD_CLASSES = {
    'pothole',
    'alligator_crack',
    'longitudinal_crack',
    'crack',
    'other',
    'not_hazard'
}

DATASET_LABEL_CLASSES = [
    'pothole',
    'alligator_crack',
    'longitudinal_crack',
    'crack',
    'other',
    'not_hazard'
]

TRAIN_CLASS_ID = {
    'pothole': 0,
    'alligator_crack': 1,
    'longitudinal_crack': 2,
    'other': 4,
    'crack': 4,
}

AUTO_RETRAIN_ON_FEEDBACK = os.getenv('AUTO_RETRAIN_ON_FEEDBACK', 'false').strip().lower() in {'1', 'true', 'yes', 'on'}
AUTO_RETRAIN_MIN_FEEDBACK = int(os.getenv('AUTO_RETRAIN_MIN_FEEDBACK', '10'))
AUTO_RETRAIN_COOLDOWN_MIN = int(os.getenv('AUTO_RETRAIN_COOLDOWN_MIN', '0'))
AUTO_RETRAIN_EPOCHS = int(os.getenv('AUTO_RETRAIN_EPOCHS', '20'))
AUTO_RETRAIN_BATCH = int(os.getenv('AUTO_RETRAIN_BATCH', '8'))
AUTO_RETRAIN_IMGSZ = int(os.getenv('AUTO_RETRAIN_IMGSZ', '640'))
AUTO_RETRAIN_RESUME = os.getenv('AUTO_RETRAIN_RESUME', 'true').strip().lower() in {'1', 'true', 'yes', 'on'}
AUTO_RETRAIN_RUNNING_GRACE_MIN = int(os.getenv('AUTO_RETRAIN_RUNNING_GRACE_MIN', '10'))
AUTO_RETRAIN_STATE_COLLECTION = os.getenv('AUTO_RETRAIN_STATE_COLLECTION', 'system_state')
AUTO_RETRAIN_STATE_DOC = os.getenv('AUTO_RETRAIN_STATE_DOC', 'auto_retrain')
REPORTS_BACKFILL_ON_READ = os.getenv('REPORTS_BACKFILL_ON_READ', 'false').strip().lower() in {'1', 'true', 'yes', 'on'}
REPORTS_BACKFILL_MAX_PER_REQUEST = int(os.getenv('REPORTS_BACKFILL_MAX_PER_REQUEST', '3'))
AUGMENT_DOWNLOAD_TIMEOUT_SEC = float(os.getenv('AUGMENT_DOWNLOAD_TIMEOUT_SEC', '5.0'))
AUGMENT_MAX_RUNTIME_SEC = float(os.getenv('AUGMENT_MAX_RUNTIME_SEC', '45.0'))
AUGMENT_INCLUDE_CONFIDENCE = os.getenv('AUGMENT_INCLUDE_CONFIDENCE', 'false').strip().lower() in {'1', 'true', 'yes', 'on'}
_augment_variants_raw = os.getenv('AUGMENT_VARIANTS', 'sun_glare').strip()
AUGMENT_VARIANTS = [v.strip() for v in _augment_variants_raw.split(',') if v.strip()]
if not AUGMENT_VARIANTS:
    AUGMENT_VARIANTS = ['sun_glare']
UPLOAD_REVERSE_GEOCODE_ON_SUBMIT = os.getenv('UPLOAD_REVERSE_GEOCODE_ON_SUBMIT', 'false').strip().lower() in {'1', 'true', 'yes', 'on'}
UPLOAD_ARCHIVE_ON_SUBMIT = os.getenv('UPLOAD_ARCHIVE_ON_SUBMIT', 'false').strip().lower() in {'1', 'true', 'yes', 'on'}

_retrain_lock = threading.Lock()
_retrain_running = False
_last_retrain_started_at = None

def initialize_firebase_app():
    """
    Initialize Firebase using one of:
    1) GOOGLE_APPLICATION_CREDENTIALS path (if provided),
    2) local firebase_credentials.json (existing local dev flow),
    3) Application Default Credentials (Cloud Run / GCP runtime).
    """
    configured_cred_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS', '').strip()
    local_cred_path = "../firebase_credentials.json"

    if configured_cred_path and os.path.exists(configured_cred_path):
        cred = credentials.Certificate(configured_cred_path)
        firebase_admin.initialize_app(cred, {'storageBucket': FIREBASE_STORAGE_BUCKET})
        print(f"Firebase initialized with GOOGLE_APPLICATION_CREDENTIALS: {configured_cred_path}")
        return

    if os.path.exists(local_cred_path):
        cred = credentials.Certificate(local_cred_path)
        firebase_admin.initialize_app(cred, {'storageBucket': FIREBASE_STORAGE_BUCKET})
        print("Firebase initialized with local firebase_credentials.json")
        return

    firebase_admin.initialize_app(options={'storageBucket': FIREBASE_STORAGE_BUCKET})
    print("Firebase initialized with Application Default Credentials")

# Initialize Firebase
initialize_firebase_app()

db = firestore.client()
bucket = storage.bucket()
GEOCODE_CACHE = {}
CONTRACTOR_DIRECTORY_COLLECTION = 'contractor_directory'
DEFAULT_CONTRACTOR_DIRECTORY = [
    {
        'id': 'prolintas',
        'name': 'Projek Lintasan Kota Holdings (PROLINTAS)',
        'type': 'Expressway operator',
        'coverage': 'Klang Valley',
        'email': 'dispatch@prolintas.sim.local',
        'phone': '+60 3-5523 8800',
        'contactPerson': 'Operations Control Desk',
        'domainHints': ['prolintas', 'prolintas.com.my']
    },
    {
        'id': 'plus',
        'name': 'PLUS Malaysia Berhad',
        'type': 'Expressway operator',
        'coverage': 'North-South corridor',
        'email': 'operations@plus.sim.local',
        'phone': '+60 3-7494 3333',
        'contactPerson': 'Expressway Maintenance Unit',
        'domainHints': ['plus', 'plus.com.my']
    },
    {
        'id': 'besraya',
        'name': 'BESRAYA (Besraya Sdn Bhd)',
        'type': 'Urban expressway operator',
        'coverage': 'Kuala Lumpur / Seri Kembangan',
        'email': 'maintenance@besraya.sim.local',
        'phone': '+60 3-9544 5577',
        'contactPerson': 'Asset & Repair Coordinator',
        'domainHints': ['besraya']
    },
    {
        'id': 'kesas',
        'name': 'KESAS Sdn Bhd',
        'type': 'Urban expressway operator',
        'coverage': 'Shah Alam / Klang Valley',
        'email': 'roadworks@kesas.sim.local',
        'phone': '+60 3-5635 8888',
        'contactPerson': 'Road Safety & Maintenance Desk',
        'domainHints': ['kesas']
    },
    {
        'id': 'sprint',
        'name': 'Sistem Penyuraian Trafik KL Barat (SPRINT)',
        'type': 'Urban expressway operator',
        'coverage': 'Kuala Lumpur',
        'email': 'ops@sprint.sim.local',
        'phone': '+60 3-7729 6888',
        'contactPerson': 'Network Maintenance Desk',
        'domainHints': ['sprint']
    },
    {
        'id': 'ijm',
        'name': 'IJM Corporation Berhad',
        'type': 'Construction and infrastructure',
        'coverage': 'Nationwide projects',
        'email': 'infra@ijm.sim.local',
        'phone': '+60 3-8026 9999',
        'contactPerson': 'Infrastructure Support Team',
        'domainHints': ['ijm', 'ijm.com']
    },
    {
        'id': 'gamuda',
        'name': 'Gamuda Berhad',
        'type': 'Construction and engineering',
        'coverage': 'Nationwide projects',
        'email': 'engineering@gamuda.sim.local',
        'phone': '+60 3-7495 6888',
        'contactPerson': 'Civil Works Desk',
        'domainHints': ['gamuda', 'gamuda.com.my']
    },
    {
        'id': 'sunway',
        'name': 'Sunway Construction Group Berhad',
        'type': 'Construction contractor',
        'coverage': 'Nationwide projects',
        'email': 'projects@sunwayconstruction.sim.local',
        'phone': '+60 3-5626 8000',
        'contactPerson': 'Project Delivery Unit',
        'domainHints': ['sunway', 'sunwayconstruction']
    },
    {
        'id': 'mrcb',
        'name': 'Malaysian Resources Corporation Berhad (MRCB)',
        'type': 'Infrastructure developer',
        'coverage': 'Urban infrastructure',
        'email': 'maintenance@mrcb.sim.local',
        'phone': '+60 3-2786 8888',
        'contactPerson': 'Urban Infrastructure Team',
        'domainHints': ['mrcb']
    },
    {
        'id': 'edgenta',
        'name': 'UEM Edgenta Berhad',
        'type': 'Asset and infrastructure services',
        'coverage': 'Nationwide operations',
        'email': 'repairs@edgenta.sim.local',
        'phone': '+60 3-7846 8888',
        'contactPerson': 'Operations Coordination Centre',
        'domainHints': ['edgenta', 'uem']
    }
]


def _slugify_contractor_id(value: str):
    slug = re.sub(r'[^a-z0-9]+', '-', str(value or '').strip().lower()).strip('-')
    return slug[:64]


def _is_valid_email_format(value: str):
    email = str(value or '').strip().lower()
    if not email:
        return False
    return bool(re.match(r'^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$', email))


def _is_valid_gmail_address(value: str):
    email = str(value or '').strip().lower()
    if not _is_valid_email_format(email):
        return False
    domain = email.split('@', 1)[1]
    return domain in {'gmail.com', 'googlemail.com'}


def _normalize_contractor_entry(raw: dict | None, fallback_id: str = ''):
    data = raw if isinstance(raw, dict) else {}
    name = (data.get('name') or '').strip()
    contractor_id = _slugify_contractor_id(data.get('id') or fallback_id or name)
    email = (data.get('email') or '').strip().lower()
    phone = (data.get('phone') or '').strip()
    contact_person = (data.get('contactPerson') or '').strip()
    contractor_type = (data.get('type') or '').strip()
    coverage = (data.get('coverage') or '').strip()

    raw_hints = data.get('domainHints') if isinstance(data.get('domainHints'), list) else []
    hints = []
    for hint in raw_hints:
        value = str(hint or '').strip().lower()
        if value and value not in hints:
            hints.append(value)

    if email and '@' in email:
        domain = email.split('@', 1)[1].strip().lower()
        local = email.split('@', 1)[0].strip().lower()
        if domain and domain not in hints:
            hints.append(domain)
        if local and local not in hints:
            hints.append(local)

    return {
        'id': contractor_id,
        'name': name,
        'type': contractor_type,
        'coverage': coverage,
        'email': email,
        'phone': phone,
        'contactPerson': contact_person,
        'domainHints': hints,
    }


def _seed_default_contractor_directory_if_empty():
    existing = list(db.collection(CONTRACTOR_DIRECTORY_COLLECTION).limit(1).stream())
    if existing:
        return

    batch = db.batch()
    now = datetime.datetime.now(datetime.timezone.utc)
    for entry in DEFAULT_CONTRACTOR_DIRECTORY:
        normalized = _normalize_contractor_entry(entry)
        if not normalized.get('id') or not normalized.get('name'):
            continue
        doc_ref = db.collection(CONTRACTOR_DIRECTORY_COLLECTION).document(normalized['id'])
        batch.set(doc_ref, {
            **normalized,
            'createdAt': now,
            'updatedAt': now
        }, merge=True)
    batch.commit()


def _get_contractor_directory_entries():
    _seed_default_contractor_directory_if_empty()
    rows = []
    docs = db.collection(CONTRACTOR_DIRECTORY_COLLECTION).stream()
    for doc in docs:
        data = doc.to_dict() or {}
        normalized = _normalize_contractor_entry(data, fallback_id=doc.id)
        if not normalized.get('id') or not normalized.get('name'):
            continue
        normalized['createdAt'] = _to_iso(data.get('createdAt'))
        normalized['updatedAt'] = _to_iso(data.get('updatedAt'))
        rows.append(normalized)
    rows.sort(key=lambda item: (item.get('name') or '').lower())
    return rows

def _to_datetime(value):
    if value is None:
        return None
    if isinstance(value, datetime.datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        except Exception:
            return None
    return None

def _as_utc(value):
    dt_value = _to_datetime(value)
    if not dt_value:
        return None
    if dt_value.tzinfo is None:
        return dt_value.replace(tzinfo=datetime.timezone.utc)
    return dt_value.astimezone(datetime.timezone.utc)

def _to_iso(value):
    dt_value = _as_utc(value)
    if not dt_value:
        return None
    return dt_value.isoformat()

def _auto_retrain_state_ref():
    return db.collection(AUTO_RETRAIN_STATE_COLLECTION).document(AUTO_RETRAIN_STATE_DOC)

def _is_external_retrain_running():
    """Detect active training process to avoid starting a second retrain."""
    target = 'train_multi_class.py'
    try:
        if os.name == 'nt':
            output = subprocess.check_output(['tasklist', '/v', '/fo', 'csv'], text=True, stderr=subprocess.DEVNULL)
            # tasklist output does not include full args reliably, fallback to WMIC process list
            try:
                wmic_output = subprocess.check_output(
                    ['wmic', 'process', 'where', "name='python.exe' or name='pythonw.exe'", 'get', 'CommandLine', '/format:list'],
                    text=True,
                    stderr=subprocess.DEVNULL
                )
                return target in wmic_output
            except Exception:
                return 'python' in output.lower() and target in output.lower()

        ps_output = subprocess.check_output(['ps', '-eo', 'pid,args'], text=True, stderr=subprocess.DEVNULL)
        return target in ps_output
    except Exception:
        return False

def _read_auto_retrain_state():
    try:
        snapshot = _auto_retrain_state_ref().get()
        if snapshot.exists:
            return snapshot.to_dict() or {}
    except Exception as read_error:
        print(f"[AUTO-RETRAIN] Could not read persisted state: {read_error}")
    return {}

def _persist_auto_retrain_state(fields: dict):
    payload = dict(fields or {})
    payload['updatedAt'] = datetime.datetime.now(datetime.timezone.utc)
    try:
        _auto_retrain_state_ref().set(payload, merge=True)
    except Exception as write_error:
        print(f"[AUTO-RETRAIN] Could not persist state: {write_error}")

def _sync_running_from_persisted_state():
    """Fast persisted lock sync to prevent double retrain across app restarts."""
    state = _read_auto_retrain_state()
    if not bool(state.get('running')):
        return False

    started_at = _as_utc(state.get('lastStartedAt'))
    if not started_at:
        _persist_auto_retrain_state({
            'running': False,
            'lastState': 'cleared_missing_started_at',
            'lastCompletedAt': datetime.datetime.now(datetime.timezone.utc),
            'error': 'Persisted running state missing lastStartedAt'
        })
        return False

    now = datetime.datetime.now(datetime.timezone.utc)
    elapsed_seconds = (now - started_at).total_seconds()
    if elapsed_seconds <= max(AUTO_RETRAIN_RUNNING_GRACE_MIN, 1) * 60:
        return True

    _persist_auto_retrain_state({
        'running': False,
        'lastState': 'cleared_stale_running_lock',
        'lastCompletedAt': now,
        'error': f'Stale running lock exceeded {AUTO_RETRAIN_RUNNING_GRACE_MIN} minutes'
    })
    return False

def _restore_auto_retrain_state():
    global _last_retrain_started_at, _retrain_running
    state = _read_auto_retrain_state()
    persisted_last_started = _to_datetime(state.get('lastStartedAt'))
    if persisted_last_started:
        _last_retrain_started_at = persisted_last_started

    _retrain_running = _sync_running_from_persisted_state()

_restore_auto_retrain_state()

# --- HELPER FUNCTIONS ---

def get_gps_from_exif(image_path):
    """
    Extracts GPS coordinates from image EXIF data.
    Returns (latitude, longitude) or (None, None) if not available.
    """
    try:
        image = Image.open(image_path)
        exif_data = image._getexif()
        
        if not exif_data:
            return None, None
        
        # Find GPS Info tag
        gps_info = {}
        for tag, value in exif_data.items():
            tag_name = TAGS.get(tag, tag)
            if tag_name == 'GPSInfo':
                for gps_tag in value:
                    gps_tag_name = GPSTAGS.get(gps_tag, gps_tag)
                    gps_info[gps_tag_name] = value[gps_tag]
        
        if not gps_info:
            return None, None
        
        # Extract latitude
        lat = None
        if 'GPSLatitude' in gps_info and 'GPSLatitudeRef' in gps_info:
            lat_data = gps_info['GPSLatitude']
            lat_ref = gps_info['GPSLatitudeRef']
            lat = convert_to_degrees(lat_data)
            if lat_ref == 'S':
                lat = -lat
        
        # Extract longitude
        lon = None
        if 'GPSLongitude' in gps_info and 'GPSLongitudeRef' in gps_info:
            lon_data = gps_info['GPSLongitude']
            lon_ref = gps_info['GPSLongitudeRef']
            lon = convert_to_degrees(lon_data)
            if lon_ref == 'W':
                lon = -lon
        
        return lat, lon
    
    except Exception as e:
        print(f"Error extracting GPS from EXIF: {e}")
        return None, None

def convert_to_degrees(value):
    """
    Convert GPS coordinates from degrees/minutes/seconds to decimal degrees.
    """
    d = float(value[0])
    m = float(value[1])
    s = float(value[2])
    return d + (m / 60.0) + (s / 3600.0)

def _safe_float(value):
    try:
        return float(value)
    except Exception:
        return None

def reverse_geocode(lat, lng):
    """
    Resolve coordinates to a readable address via Nominatim.
    Returns address string or empty string when unavailable.
    """
    latitude = _safe_float(lat)
    longitude = _safe_float(lng)
    if latitude is None or longitude is None:
        return ''

    cache_key = f"{latitude:.6f},{longitude:.6f}"
    if cache_key in GEOCODE_CACHE:
        return GEOCODE_CACHE[cache_key]

    query = urllib.parse.urlencode({
        'format': 'jsonv2',
        'lat': latitude,
        'lon': longitude,
        'zoom': 18,
        'addressdetails': 1
    })
    url = f"https://nominatim.openstreetmap.org/reverse?{query}"

    try:
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'RoadHazardFYP/1.0 (Dashboard reverse geocoding)'
            }
        )
        with urllib.request.urlopen(req, timeout=4) as response:
            payload = json.loads(response.read().decode('utf-8'))
            resolved = (payload.get('display_name') or '').strip()
            GEOCODE_CACHE[cache_key] = resolved
            return resolved
    except Exception as geocode_error:
        print(f"Reverse geocode failed for ({latitude}, {longitude}): {geocode_error}")
        GEOCODE_CACHE[cache_key] = ''
        return ''

def get_model():
    """
    Lazy-load YOLO model so service can start even if model init fails.
    This avoids container boot crashes on Cloud Run and surfaces status via /api/health.
    """
    global model, model_load_error, _model_loaded_mtime, _model_loaded_path, MODEL_PATH
    MODEL_PATH = _resolve_default_model_path()
    model_path = Path(MODEL_PATH)
    current_mtime = None
    if model_path.exists():
        try:
            current_mtime = model_path.stat().st_mtime
        except Exception:
            current_mtime = None

    if model is not None and _model_loaded_path == MODEL_PATH and _model_loaded_mtime == current_mtime:
        return model

    try:
        model = YOLO(MODEL_PATH)
        try:
            model.fuse()
        except Exception:
            pass
        model_load_error = None
        _model_loaded_mtime = current_mtime
        _model_loaded_path = MODEL_PATH
        print(f"YOLO model loaded: {MODEL_PATH}")
        return model
    except Exception as load_error:
        model_load_error = str(load_error)
        print(f"ERROR loading YOLO model from {MODEL_PATH}: {load_error}")
        raise

def _class_min_conf(label: str):
    """
    Optional per-class minimum confidence override.
    Env example:
      INFER_CLASS_CONF={"pothole":0.45,"alligator_crack":0.25,"longitudinal_crack":0.25,"other":0.30}
    """
    try:
        if not isinstance(INFER_CLASS_CONF, dict):
            return INFER_CONF
        class_key = (label or '').strip().lower()
        threshold = INFER_CLASS_CONF.get(class_key)
        if threshold is None:
            return INFER_CONF
        return float(threshold)
    except Exception:
        return INFER_CONF

def _normalize_label(label: str, conf: float):
    """
    Convert uncertain crack subtype predictions into generic 'crack' label.
    This avoids showing incorrect fine-grained hazard type at low confidence.
    """
    crack_subtypes = {'alligator_crack', 'longitudinal_crack'}
    class_key = (label or '').strip().lower()
    if class_key in {'transverse_crack', 'transversal_crack'}:
        return 'not_hazard'
    if class_key == 'other' and INFER_REMAP_OTHER_TO_CRACK:
        return 'crack'
    if class_key in crack_subtypes and conf < INFER_CRACK_SUBTYPE_MIN_CONF:
        return 'crack'
    return label

def _normalize_line_angle_deg(angle_rad):
    angle = np.degrees(angle_rad) % 180.0
    if angle < 0:
        angle += 180.0
    return angle

def _angle_distance_deg(a, b):
    distance = abs(a - b) % 180.0
    return min(distance, 180.0 - distance)

def _estimate_orientation_deg(edges):
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=20, minLineLength=10, maxLineGap=5)
    if lines is None or len(lines) == 0:
        return None, None, 0

    angles = []
    lengths = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        dx = x2 - x1
        dy = y2 - y1
        length = np.hypot(dx, dy)
        if length < 3:
            continue
        angles.append(_normalize_line_angle_deg(np.arctan2(dy, dx)))
        lengths.append(length)

    if not angles:
        return None, None, 0

    bins = np.arange(0, 181, 10)
    hist, bin_edges = np.histogram(angles, bins=bins, weights=lengths)
    peak_idx = int(np.argmax(hist))
    dominant = float((bin_edges[peak_idx] + bin_edges[peak_idx + 1]) / 2.0)

    weighted_dist = 0.0
    total_weight = float(np.sum(lengths))
    for angle, weight in zip(angles, lengths):
        weighted_dist += _angle_distance_deg(angle, dominant) * weight
    dispersion = weighted_dist / max(total_weight, 1e-6)

    return dominant, dispersion, len(angles)

def _analyze_crack_pattern(region, road_axis='vertical'):
    if region is None or region.size == 0:
        return 'other', 0.0

    h, w = region.shape[:2]
    if h < 20 or w < 20:
        return 'other', 0.0

    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)

    edge_pixel_ratio = float(np.sum(edges > 0)) / float(edges.size)
    contours, _ = cv2.findContours(edges, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    dominant_angle, angle_dispersion, _ = _estimate_orientation_deg(edges)
    num_contours = len(contours)

    if edge_pixel_ratio > 0.12 and num_contours > 12:
        if dominant_angle is None or angle_dispersion is None or angle_dispersion > 28:
            confidence = min(0.92, 0.45 + edge_pixel_ratio * 1.8)
            return 'alligator_crack', confidence

    if dominant_angle is None or angle_dispersion is None:
        return 'other', 0.45

    if road_axis == 'horizontal':
        longitudinal_ref = 0.0
        transverse_ref = 90.0
    else:
        longitudinal_ref = 90.0
        transverse_ref = 0.0

    d_long = _angle_distance_deg(dominant_angle, longitudinal_ref)
    d_trans = _angle_distance_deg(dominant_angle, transverse_ref)

    def _linear_confidence(distance_deg, dispersion_deg):
        # Blend orientation agreement and directional coherence to avoid repetitive overconfident labels.
        orientation_score = max(0.0, min(1.0, 1.0 - (distance_deg / 90.0)))
        dispersion_score = max(0.0, min(1.0, 1.0 - (dispersion_deg / 32.0)))
        raw_score = 0.42 + (0.28 * orientation_score) + (0.20 * dispersion_score)
        return max(0.50, min(0.86, raw_score))

    if angle_dispersion <= 25:
        if d_long <= d_trans:
            conf = _linear_confidence(d_long, angle_dispersion)
            return 'longitudinal_crack', conf
        conf = _linear_confidence(d_trans, angle_dispersion)
        if conf >= 0.0:
            return 'not_hazard', conf

    return 'other', 0.5

def _reanalyze_pothole_prediction(image_bgr, bbox_norm, pothole_conf):
    if image_bgr is None or not INFER_POTHOLE_RECHECK:
        return None, None

    h, w = image_bgr.shape[:2]
    x1 = int(clamp01(bbox_norm.get('x', 0.0)) * w)
    y1 = int(clamp01(bbox_norm.get('y', 0.0)) * h)
    x2 = int(clamp01(bbox_norm.get('x2', 0.0)) * w)
    y2 = int(clamp01(bbox_norm.get('y2', 0.0)) * h)

    if x2 <= x1 or y2 <= y1:
        return None, None

    region = image_bgr[y1:y2, x1:x2]
    region_h, region_w = region.shape[:2]
    if region_h <= 0 or region_w <= 0:
        return None, None

    crack_label, crack_conf = _analyze_crack_pattern(region, road_axis=INFER_ROAD_AXIS)
    if crack_label not in {'alligator_crack', 'longitudinal_crack'}:
        return None, None

    linear_cracks = {'longitudinal_crack'}
    aspect = max(region_w / max(region_h, 1), region_h / max(region_w, 1))

    # Conservative guardrails: do not flip high-confidence potholes into linear cracks.
    if crack_label in linear_cracks:
        if pothole_conf > INFER_POTHOLE_LINEAR_MAX_BASE_CONF:
            return None, None
        if aspect < INFER_POTHOLE_LINEAR_MIN_ASPECT:
            return None, None
        if crack_conf < INFER_POTHOLE_RECLASSIFY_LINEAR_MIN_CRACK_CONF:
            return None, None
        # Linear crack must beat pothole confidence by a small but explicit margin.
        if (crack_conf - pothole_conf) < INFER_POTHOLE_RECLASSIFY_LINEAR_MIN_ADVANTAGE:
            return None, None

    # Keep very high-confidence potholes unless crack evidence is also very strong.
    if pothole_conf >= INFER_POTHOLE_LOCK_CONF and crack_conf < pothole_conf:
        return None, None

    # Reclassify when crack evidence is strong enough and not far behind pothole confidence.
    if crack_conf >= INFER_POTHOLE_RECLASSIFY_MIN_CRACK_CONF and (pothole_conf - crack_conf) <= INFER_POTHOLE_RECLASSIFY_MAX_MARGIN:
        return crack_label, max(pothole_conf, crack_conf)

    return None, None

def _extract_region_from_bbox_norm(image_bgr, bbox_norm):
    if image_bgr is None or bbox_norm is None:
        return None

    h, w = image_bgr.shape[:2]
    x1 = int(clamp01(bbox_norm.get('x', 0.0)) * w)
    y1 = int(clamp01(bbox_norm.get('y', 0.0)) * h)
    x2 = int(clamp01(bbox_norm.get('x2', 0.0)) * w)
    y2 = int(clamp01(bbox_norm.get('y2', 0.0)) * h)

    if x2 <= x1 or y2 <= y1:
        return None

    region = image_bgr[y1:y2, x1:x2]
    if region is None or region.size == 0:
        return None
    return region

def _looks_shadow_dominant(region_bgr):
    if region_bgr is None or region_bgr.size == 0:
        return False

    h, w = region_bgr.shape[:2]
    if h < 24 or w < 24:
        return False

    gray = cv2.cvtColor(region_bgr, cv2.COLOR_BGR2GRAY)
    # Large contiguous dark regions are more likely to be cast shadows than crack texture.
    dark_mask = (gray < 72).astype(np.uint8)
    dark_ratio = float(np.mean(dark_mask))
    if dark_ratio < INFER_SHADOW_GUARD_DARK_RATIO:
        return False

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(dark_mask, connectivity=8)
    largest_component_ratio = 0.0
    if num_labels > 1:
        # Skip background label 0.
        largest_area = int(np.max(stats[1:, cv2.CC_STAT_AREA]))
        largest_component_ratio = largest_area / float(h * w)

    if largest_component_ratio < INFER_SHADOW_GUARD_LARGEST_COMPONENT_RATIO:
        return False

    return True

def _refine_crack_bbox_norm(image_bgr, bbox_norm):
    if image_bgr is None or bbox_norm is None:
        return None

    h, w = image_bgr.shape[:2]
    x1 = int(clamp01(bbox_norm.get('x', 0.0)) * w)
    y1 = int(clamp01(bbox_norm.get('y', 0.0)) * h)
    x2 = int(clamp01(bbox_norm.get('x2', 0.0)) * w)
    y2 = int(clamp01(bbox_norm.get('y2', 0.0)) * h)

    if x2 <= x1 or y2 <= y1:
        return None

    roi = image_bgr[y1:y2, x1:x2]
    roi_h, roi_w = roi.shape[:2]
    if roi_h < 24 or roi_w < 24:
        return None

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    # Black-hat emphasizes dark, thin structures (cracks) more than broad smooth shadows.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
    blackhat = cv2.GaussianBlur(blackhat, (3, 3), 0)
    _, mask = cv2.threshold(blackhat, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))

    nz = cv2.findNonZero(mask)
    if nz is None:
        return None

    rx, ry, rw, rh = cv2.boundingRect(nz)
    if rw <= 0 or rh <= 0:
        return None

    orig_area = float(max((x2 - x1) * (y2 - y1), 1))
    refined_area = float(rw * rh)
    area_ratio = refined_area / orig_area
    if area_ratio < INFER_CRACK_BBOX_REFINEMENT_MIN_AREA_RATIO:
        return None
    if area_ratio > INFER_CRACK_BBOX_REFINEMENT_MAX_AREA_RATIO:
        return None

    # Slight padding keeps context and avoids clipping thin crack branches.
    pad_x = max(1, int(round(rw * 0.05)))
    pad_y = max(1, int(round(rh * 0.05)))

    nx1 = max(0, x1 + rx - pad_x)
    ny1 = max(0, y1 + ry - pad_y)
    nx2 = min(w - 1, x1 + rx + rw + pad_x)
    ny2 = min(h - 1, y1 + ry + rh + pad_y)
    if nx2 <= nx1 or ny2 <= ny1:
        return None

    x_min = nx1 / float(max(w, 1))
    y_min = ny1 / float(max(h, 1))
    x_max = nx2 / float(max(w, 1))
    y_max = ny2 / float(max(h, 1))

    return {
        'x': x_min,
        'y': y_min,
        'width': max(x_max - x_min, 0.0),
        'height': max(y_max - y_min, 0.0),
        'x2': x_max,
        'y2': y_max
    }

def _bbox_area_norm(bbox_norm):
    if not isinstance(bbox_norm, dict):
        return 0.0
    try:
        return clamp01(bbox_norm.get('width', 0.0)) * clamp01(bbox_norm.get('height', 0.0))
    except Exception:
        return 0.0

def _relocalize_crack_bbox(current_model, image_bgr, bbox_norm):
    if image_bgr is None or bbox_norm is None:
        return None

    base_area = _bbox_area_norm(bbox_norm)
    if base_area < INFER_CRACK_RELOCALIZE_MIN_IMAGE_AREA:
        return None

    h, w = image_bgr.shape[:2]
    x1 = int(clamp01(bbox_norm.get('x', 0.0)) * w)
    y1 = int(clamp01(bbox_norm.get('y', 0.0)) * h)
    x2 = int(clamp01(bbox_norm.get('x2', 0.0)) * w)
    y2 = int(clamp01(bbox_norm.get('y2', 0.0)) * h)
    if x2 <= x1 or y2 <= y1:
        return None

    roi = image_bgr[y1:y2, x1:x2]
    roi_h, roi_w = roi.shape[:2]
    if roi_h < 24 or roi_w < 24:
        return None

    local_results = current_model(roi, conf=min(INFER_CONF, INFER_CRACK_RELOCALIZE_CONF), iou=INFER_IOU, classes=INFER_CLASSES)
    best = None

    for result in local_results:
        for box in result.boxes:
            cls_id = int(box.cls[0])
            raw_label = current_model.names.get(cls_id, 'unknown')
            conf = float(box.conf[0])

            label = _normalize_label(raw_label, conf)
            if _hazard_family(label) != 'crack':
                continue

            lx1, ly1, lx2, ly2 = box.xyxyn[0].tolist()
            lx1 = clamp01(lx1)
            ly1 = clamp01(ly1)
            lx2 = clamp01(lx2)
            ly2 = clamp01(ly2)
            if lx2 <= lx1 or ly2 <= ly1:
                continue

            abs_x1 = x1 + int(round(lx1 * roi_w))
            abs_y1 = y1 + int(round(ly1 * roi_h))
            abs_x2 = x1 + int(round(lx2 * roi_w))
            abs_y2 = y1 + int(round(ly2 * roi_h))
            if abs_x2 <= abs_x1 or abs_y2 <= abs_y1:
                continue

            gx1 = clamp01(abs_x1 / float(max(w, 1)))
            gy1 = clamp01(abs_y1 / float(max(h, 1)))
            gx2 = clamp01(abs_x2 / float(max(w, 1)))
            gy2 = clamp01(abs_y2 / float(max(h, 1)))
            candidate_bbox = {
                'x': gx1,
                'y': gy1,
                'width': max(gx2 - gx1, 0.0),
                'height': max(gy2 - gy1, 0.0),
                'x2': gx2,
                'y2': gy2
            }
            candidate_area = _bbox_area_norm(candidate_bbox)
            if candidate_area <= 0:
                continue
            if candidate_area > (base_area * INFER_CRACK_RELOCALIZE_MAX_AREA_RATIO):
                continue

            score = conf
            if best is None or score > best['score']:
                best = {
                    'score': score,
                    'label': label,
                    'confidence': conf,
                    'bbox': candidate_bbox
                }

    if not best:
        return None
    return best

def _compute_image_fingerprint_bytes(image_bytes: bytes):
    if not image_bytes:
        return ''
    try:
        return hashlib.sha256(image_bytes).hexdigest()
    except Exception:
        return ''

def _compute_image_fingerprint_file(file_path: str):
    if not file_path or not os.path.exists(file_path):
        return ''
    try:
        with open(file_path, 'rb') as input_file:
            return _compute_image_fingerprint_bytes(input_file.read())
    except Exception:
        return ''

def _normalize_target_detection_boxes(target_detection_bbox=None, target_detection_bboxes=None):
    boxes = _normalize_feedback_bboxes(target_detection_bboxes, target_detection_bbox)
    if boxes:
        return boxes
    if isinstance(target_detection_bbox, dict):
        box = _normalize_feedback_bbox(target_detection_bbox)
        if box:
            return [box]
    return []

def _lookup_feedback_guidance_by_fingerprint(image_fingerprint: str):
    fingerprint = (image_fingerprint or '').strip()
    if not fingerprint:
        return None

    try:
        docs = db.collection('training_feedback').where('imageFingerprint', '==', fingerprint).stream()
    except Exception:
        return None

    best_payload = None
    best_ts = None
    for doc in docs:
        payload = doc.to_dict() or {}
        boxes = _normalize_target_detection_boxes(
            payload.get('targetDetectionBBox') if isinstance(payload.get('targetDetectionBBox'), dict) else None,
            payload.get('targetDetectionBBoxes') if isinstance(payload.get('targetDetectionBBoxes'), list) else None
        )
        if not boxes:
            continue

        created_at = payload.get('createdAt')
        if hasattr(created_at, 'timestamp'):
            try:
                created_ts = created_at.timestamp()
            except Exception:
                created_ts = 0.0
        else:
            created_ts = 0.0

        if best_payload is None or created_ts >= (best_ts or 0.0):
            best_payload = payload
            best_ts = created_ts

    return best_payload

def _apply_feedback_guidance_to_detections(detections, guidance_payload):
    if not isinstance(detections, list) or not detections or not isinstance(guidance_payload, dict):
        return detections, None

    target_boxes = _normalize_target_detection_boxes(
        guidance_payload.get('targetDetectionBBox') if isinstance(guidance_payload.get('targetDetectionBBox'), dict) else None,
        guidance_payload.get('targetDetectionBBoxes') if isinstance(guidance_payload.get('targetDetectionBBoxes'), list) else None
    )
    if not target_boxes:
        return detections, None

    guidance_class = _normalize_hazard_label(guidance_payload.get('finalClass') or guidance_payload.get('correctedClass') or 'other')
    same_class_indices = [idx for idx, detection in enumerate(detections) if _normalize_hazard_label((detection or {}).get('class') or '') == guidance_class]
    if not same_class_indices:
        return detections, None

    target_bbox = max(target_boxes, key=lambda box: _bbox_area_norm(box))
    if not isinstance(target_bbox, dict):
        return detections, None

    guidance_family = _hazard_family(guidance_class)
    if not same_class_indices and guidance_family == 'crack':
        same_class_indices = [idx for idx, detection in enumerate(detections) if _hazard_family((detection or {}).get('class') or '') == 'crack']

    if not same_class_indices:
        return detections, None

    best_index = max(same_class_indices, key=lambda idx: float((detections[idx] or {}).get('confidence') or 0.0))
    updated_detections = [dict(detection) if isinstance(detection, dict) else detection for detection in detections]
    current_detection = dict(updated_detections[best_index])
    current_detection['bbox'] = target_bbox
    current_detection['feedbackGuidance'] = {
        'applied': True,
        'sourceClass': guidance_class,
        'targetDetectionCount': len(target_boxes)
    }
    updated_detections[best_index] = current_detection
    return updated_detections, guidance_payload.get('recordId') or None

def clamp01(value):
    return max(min(float(value), 1.0), 0.0)

def _normalize_hazard_label(label: str):
    normalized = (label or '').strip().lower().replace(' ', '_')
    if normalized in {'transversal_crack', 'transverse_crack'}:
        normalized = 'not_hazard'
    if normalized == 'others':
        normalized = 'other'
    if normalized == 'other' and INFER_REMAP_OTHER_TO_CRACK:
        normalized = 'crack'
    return normalized

def _top_detection(detections):
    if not isinstance(detections, list) or len(detections) == 0:
        return None
    return max(detections, key=lambda d: float((d or {}).get('confidence') or 0.0))

def _hazard_family(label: str):
    class_key = _normalize_hazard_label(label)
    if class_key == 'pothole':
        return 'pothole'
    if class_key in {'crack', 'alligator_crack', 'longitudinal_crack'}:
        return 'crack'
    return 'other'

def _scenario_weight(scenario_name: str):
    key = (scenario_name or '').strip().lower()
    if key == 'original':
        return max(SCENARIO_ORIGINAL_WEIGHT, 1.0)
    if 'low_light' in key or 'fog' in key:
        return 0.95
    return 1.0

def _consensus_from_scenarios(scenarios):
    if not isinstance(scenarios, list) or len(scenarios) == 0:
        return {
            'detected': False,
            'hazardClass': None,
            'confidence': 0.0,
            'stable': False,
            'margin': 0.0,
            'supportingScenarios': 0,
            'totalDetectedScenarios': 0,
            'classScores': {}
        }

    class_scores = {}
    family_scores = {}
    class_support = {}
    detected_scenarios = 0

    for scenario in scenarios:
        if not isinstance(scenario, dict) or not bool(scenario.get('detected')):
            continue

        detected_scenarios += 1
        weight = _scenario_weight(str(scenario.get('scenario') or ''))
        scenario_class_scores = scenario.get('classScores')
        if not isinstance(scenario_class_scores, dict) or len(scenario_class_scores) == 0:
            top_class = _normalize_hazard_label(scenario.get('topClass') or 'other')
            top_conf = float(scenario.get('topConfidence') or 0.0)
            if top_conf > 0:
                scenario_class_scores = {top_class: top_conf}
            else:
                scenario_class_scores = {}

        for raw_class, raw_score in scenario_class_scores.items():
            class_key = _normalize_hazard_label(raw_class)
            try:
                score = float(raw_score)
            except Exception:
                continue

            if score <= 0:
                continue

            weighted_score = score * weight
            class_scores[class_key] = class_scores.get(class_key, 0.0) + weighted_score
            class_support[class_key] = class_support.get(class_key, 0) + 1

            family_key = _hazard_family(class_key)
            family_scores[family_key] = family_scores.get(family_key, 0.0) + weighted_score

    if len(class_scores) == 0:
        return {
            'detected': False,
            'hazardClass': None,
            'confidence': 0.0,
            'stable': False,
            'margin': 0.0,
            'supportingScenarios': 0,
            'totalDetectedScenarios': detected_scenarios,
            'classScores': {}
        }

    ranked = sorted(class_scores.items(), key=lambda item: item[1], reverse=True)
    top_class, top_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0.0
    total_score = max(sum(class_scores.values()), 1e-6)
    margin = (top_score - second_score) / total_score

    final_class = top_class
    top_family = _hazard_family(top_class)
    crack_subtypes = {'alligator_crack', 'longitudinal_crack'}

    if top_family == 'crack':
        crack_family_total = max(family_scores.get('crack', 0.0), 1e-6)
        ranked_subtypes = sorted(
            [(cls, score) for cls, score in class_scores.items() if cls in crack_subtypes],
            key=lambda item: item[1],
            reverse=True
        )
        if len(ranked_subtypes) == 0:
            final_class = 'crack'
        else:
            subtype_top_class, subtype_top_score = ranked_subtypes[0]
            subtype_second_score = ranked_subtypes[1][1] if len(ranked_subtypes) > 1 else 0.0
            subtype_margin = (subtype_top_score - subtype_second_score) / crack_family_total
            if subtype_margin >= SCENARIO_CONSENSUS_MIN_MARGIN:
                final_class = subtype_top_class
            else:
                final_class = 'crack'

    final_score = class_scores.get(final_class, 0.0)
    if final_class == 'crack':
        final_score = family_scores.get('crack', final_score)

    stable = bool(final_score >= SCENARIO_CONSENSUS_MIN_SCORE and margin >= SCENARIO_CONSENSUS_MIN_MARGIN)

    return {
        'detected': True,
        'hazardClass': final_class,
        'confidence': round(final_score / total_score, 4),
        'stable': stable,
        'margin': round(margin, 4),
        'supportingScenarios': int(class_support.get(final_class, detected_scenarios if final_class == 'crack' else 0)),
        'totalDetectedScenarios': detected_scenarios,
        'classScores': {cls: round(score, 4) for cls, score in ranked}
    }

def _count_pending_feedback():
    try:
        pending_docs = db.collection('training_feedback').where('usedForTraining', '==', False).stream()
        return sum(1 for _ in pending_docs)
    except Exception:
        return 0

def _mark_pending_feedback_used():
    try:
        pending_docs = db.collection('training_feedback').where('usedForTraining', '==', False).stream()
        updated = 0
        now = datetime.datetime.now()
        for doc in pending_docs:
            doc.reference.update({
                'usedForTraining': True,
                'usedAt': now
            })
            updated += 1
        return updated
    except Exception as e:
        print(f"[AUTO-RETRAIN] Could not mark feedback as used: {e}")
        return 0

def _select_feedback_bbox(detections, final_class, target_detection_index=None, target_detection_bbox=None):
    if not isinstance(detections, list):
        return None

    final_class_key = _normalize_hazard_label(final_class)

    def _normalized_bbox(det):
        if not isinstance(det, dict):
            return None
        bbox = det.get('bbox') or {}
        x = bbox.get('x')
        y = bbox.get('y')
        w = bbox.get('width')
        h = bbox.get('height')
        try:
            x = clamp01(x)
            y = clamp01(y)
            w = clamp01(w)
            h = clamp01(h)
        except Exception:
            return None
        if w <= 0 or h <= 0:
            return None
        return {'x': x, 'y': y, 'width': w, 'height': h}

    if isinstance(target_detection_bbox, dict):
        target_bbox = _normalized_bbox({'bbox': target_detection_bbox})
        if target_bbox:
            return target_bbox

    if isinstance(target_detection_index, int) and 0 <= target_detection_index < len(detections):
        target_bbox = _normalized_bbox(detections[target_detection_index])
        if target_bbox:
            return target_bbox

    same_class = []
    fallback = []
    for det in detections:
        bbox = _normalized_bbox(det)
        if not bbox:
            continue
        conf = float((det or {}).get('confidence') or 0.0)
        det_class = _normalize_hazard_label((det or {}).get('class') or '')
        item = (conf, bbox)
        if det_class == final_class_key:
            same_class.append(item)
        fallback.append(item)

    if same_class:
        same_class.sort(key=lambda item: item[0], reverse=True)
        return same_class[0][1]
    if fallback:
        fallback.sort(key=lambda item: item[0], reverse=True)
        return fallback[0][1]
    return None


def _normalize_feedback_bbox(bbox_raw):
    if not isinstance(bbox_raw, dict):
        return None
    try:
        x = clamp01(bbox_raw.get('x'))
        y = clamp01(bbox_raw.get('y'))
        width = clamp01(bbox_raw.get('width'))
        height = clamp01(bbox_raw.get('height'))
    except Exception:
        return None
    if width <= 0 or height <= 0:
        return None
    return {'x': x, 'y': y, 'width': width, 'height': height}


def _normalize_feedback_bboxes(target_detection_bboxes=None, target_detection_bbox=None):
    normalized = []
    if isinstance(target_detection_bboxes, list):
        for bbox_raw in target_detection_bboxes:
            bbox = _normalize_feedback_bbox(bbox_raw)
            if bbox:
                normalized.append(bbox)

    if not normalized and isinstance(target_detection_bbox, dict):
        bbox = _normalize_feedback_bbox(target_detection_bbox)
        if bbox:
            normalized.append(bbox)

    return normalized

def _write_feedback_sample(project_root: Path, record_id: str, doc_id: str, media_url: str, final_class: str, detections, target_detection_index=None, target_detection_bbox=None, target_detection_bboxes=None):
    dataset_root = project_root / 'datasets' / 'road_hazards_combined'
    train_images_dir = dataset_root / 'train' / 'images'
    train_labels_dir = dataset_root / 'train' / 'labels'
    train_images_dir.mkdir(parents=True, exist_ok=True)
    train_labels_dir.mkdir(parents=True, exist_ok=True)

    safe_record = ''.join(ch for ch in (record_id or 'unknown') if ch.isalnum())[:24] or 'unknown'
    safe_doc = ''.join(ch for ch in (doc_id or 'doc') if ch.isalnum())[:16] or 'doc'
    stem = f"fb_{safe_record}_{safe_doc}"
    image_path = train_images_dir / f"{stem}.jpg"
    label_path = train_labels_dir / f"{stem}.txt"

    with urllib.request.urlopen(media_url, timeout=10) as response:
        image_bytes = response.read()
    if not image_bytes:
        raise RuntimeError('Downloaded image is empty')
    with open(image_path, 'wb') as f:
        f.write(image_bytes)

    normalized_class = _normalize_hazard_label(final_class)
    class_group = normalized_class if normalized_class in HAZARD_CLASSES else 'other'
    grouped_root = dataset_root / 'feedback_by_class' / class_group
    grouped_images_dir = grouped_root / 'images'
    grouped_labels_dir = grouped_root / 'labels'
    grouped_images_dir.mkdir(parents=True, exist_ok=True)
    grouped_labels_dir.mkdir(parents=True, exist_ok=True)
    grouped_image_path = grouped_images_dir / f"{stem}.jpg"
    grouped_label_path = grouped_labels_dir / f"{stem}.txt"

    if normalized_class == 'not_hazard':
        # Background sample (no objects)
        with open(label_path, 'w', encoding='utf-8') as f:
            f.write('')
        shutil.copy2(image_path, grouped_image_path)
        shutil.copy2(label_path, grouped_label_path)
        return str(image_path), str(label_path), 'background', str(grouped_image_path), str(grouped_label_path), class_group

    class_id = TRAIN_CLASS_ID.get(normalized_class)
    if class_id is None:
        class_id = TRAIN_CLASS_ID['other']

    bboxes = _normalize_feedback_bboxes(target_detection_bboxes, target_detection_bbox)
    if not bboxes:
        fallback_bbox = _select_feedback_bbox(detections, normalized_class, target_detection_index, target_detection_bbox)
        if fallback_bbox:
                        bboxes = [fallback_bbox]
    if not bboxes:
        raise RuntimeError('No usable bbox found for feedback sample')

    with open(label_path, 'w', encoding='utf-8') as f:
        for bbox in bboxes:
            x = clamp01(bbox['x'])
            y = clamp01(bbox['y'])
            w = clamp01(bbox['width'])
            h = clamp01(bbox['height'])
            x_center = clamp01(x + (w / 2.0))
            y_center = clamp01(y + (h / 2.0))
            f.write(f"{class_id} {x_center:.6f} {y_center:.6f} {w:.6f} {h:.6f}\n")

    shutil.copy2(image_path, grouped_image_path)
    shutil.copy2(label_path, grouped_label_path)
    return str(image_path), str(label_path), 'labeled', str(grouped_image_path), str(grouped_label_path), class_group

def _preview_color_bgr(label: str):
    class_key = _normalize_hazard_label(label)
    if class_key == 'pothole':
        return (37, 96, 247)
    if class_key == 'alligator_crack':
        return (58, 183, 120)
    if class_key == 'longitudinal_crack':
        return (86, 205, 255)
    if class_key == 'crack':
        return (126, 87, 194)
    return (128, 128, 128)

def _encode_scenario_preview(image_bgr, detections=None):
    if image_bgr is None or getattr(image_bgr, 'size', 0) == 0:
        return None

    preview = image_bgr.copy()
    h, w = preview.shape[:2]
    if max(h, w) > 960:
        scale = 960.0 / float(max(h, w))
        preview = cv2.resize(preview, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
        h, w = preview.shape[:2]

    for det in detections or []:
        if not isinstance(det, dict):
            continue
        bbox = det.get('bbox') or {}
        try:
            x = clamp01(bbox.get('x'))
            y = clamp01(bbox.get('y'))
            bw = clamp01(bbox.get('width'))
            bh = clamp01(bbox.get('height'))
        except Exception:
            continue
        if bw <= 0 or bh <= 0:
            continue

        x1 = max(0, min(int(round(x * w)), w - 1))
        y1 = max(0, min(int(round(y * h)), h - 1))
        x2 = max(x1 + 1, min(int(round((x + bw) * w)), w - 1))
        y2 = max(y1 + 1, min(int(round((y + bh) * h)), h - 1))
        color = _preview_color_bgr(det.get('class') or '')
        cv2.rectangle(preview, (x1, y1), (x2, y2), color, 2)
        label = f"{str(det.get('class') or 'unknown').replace('_', ' ')} {float(det.get('confidence') or 0.0) * 100:.1f}%"
        (text_w, text_h), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.48, 1)
        label_y1 = max(0, y1 - text_h - baseline - 6)
        label_y2 = min(h - 1, label_y1 + text_h + baseline + 6)
        label_x2 = min(w - 1, x1 + text_w + 8)
        cv2.rectangle(preview, (x1, label_y1), (label_x2, label_y2), color, -1)
        cv2.putText(preview, label, (x1 + 4, label_y2 - baseline - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (255, 255, 255), 1, cv2.LINE_AA)

    ok, encoded = cv2.imencode('.jpg', preview, [int(cv2.IMWRITE_JPEG_QUALITY), 78])
    if not ok:
        return None
    return f"data:image/jpeg;base64,{base64.b64encode(encoded.tobytes()).decode('ascii')}"

def _download_image_bgr(media_url: str, timeout_sec: float = 10.0):
    try:
        with urllib.request.urlopen(media_url, timeout=max(1.0, float(timeout_sec))) as response:
            image_bytes = response.read()
    except Exception:
        return None

    if not image_bytes:
        return None

    np_bytes = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(np_bytes, cv2.IMREAD_COLOR)
    return image

def _normalize_detection_for_label(det):
    if not isinstance(det, dict):
        return None

    det_class = _normalize_hazard_label(det.get('class') or '')
    class_id = TRAIN_CLASS_ID.get(det_class)
    if class_id is None:
        return None

    bbox = det.get('bbox') or {}
    try:
        x = clamp01(bbox.get('x'))
        y = clamp01(bbox.get('y'))
        w = clamp01(bbox.get('width'))
        h = clamp01(bbox.get('height'))
    except Exception:
        return None

    if w <= 0 or h <= 0:
        return None

    x_center = clamp01(x + (w / 2.0))
    y_center = clamp01(y + (h / 2.0))
    return class_id, x_center, y_center, w, h

def _tropical_aug_sun_glare(image_bgr, intensity=0.55):
    intensity = max(0.0, min(1.0, float(intensity)))
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    value_scale = 1.0 + intensity * 0.7
    hsv[:, :, 2] = np.clip(hsv[:, :, 2] * value_scale, 0, 255)
    bright = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

    h, w = bright.shape[:2]
    flare_count = random.randint(1, 3)
    flare_layer = np.zeros((h, w), dtype=np.float32)

    for _ in range(flare_count):
        center = (
            random.randint(0, max(w - 1, 0)),
            random.randint(0, max(int(h * 0.55), 1))
        )
        radius = random.randint(max(20, min(h, w) // 10), max(30, min(h, w) // 3))
        cv2.circle(flare_layer, center, radius, random.uniform(50.0 * intensity, 190.0 * intensity), -1)

    flare_layer = cv2.GaussianBlur(flare_layer, (0, 0), sigmaX=max(8, min(h, w) / 16))
    flare_layer = np.clip(flare_layer, 0, 255).astype(np.uint8)
    flare_bgr = cv2.merge([flare_layer, flare_layer, flare_layer])
    return cv2.addWeighted(bright, 1.0, flare_bgr, intensity * 0.55, 0)

def _tropical_aug_monsoon_rain(image_bgr, intensity=0.55):
    intensity = max(0.0, min(1.0, float(intensity)))
    h, w = image_bgr.shape[:2]
    rain_layer = np.zeros((h, w), dtype=np.float32)
    near_layer = np.zeros((h, w), dtype=np.float32)

    base_count = max(60, min(900, int((h * w) / 3800)))
    streak_count = int(base_count * (0.35 + 1.15 * intensity))
    for _ in range(streak_count):
        x1 = random.randint(0, max(w - 1, 0))
        y1 = random.randint(0, max(h - 1, 0))
        length = random.randint(12, int(24 + 16 * intensity))
        angle = np.deg2rad(random.uniform(72, 108))
        x2 = int(x1 + length * np.cos(angle))
        y2 = int(y1 + length * np.sin(angle))
        color = random.uniform(120.0, 235.0)
        thickness = 1 if random.random() < 0.8 else 2
        cv2.line(rain_layer, (x1, y1), (x2, y2), color, thickness)

    near_count = int(max(8, streak_count * (0.08 + 0.14 * intensity)))
    for _ in range(near_count):
        x1 = random.randint(0, max(w - 1, 0))
        y1 = random.randint(0, max(h - 1, 0))
        length = random.randint(int(22 + 8 * intensity), int(46 + 16 * intensity))
        angle = np.deg2rad(random.uniform(74, 106))
        x2 = int(x1 + length * np.cos(angle))
        y2 = int(y1 + length * np.sin(angle))
        color = random.uniform(185.0, 255.0)
        thickness = random.choice([2, 2, 3])
        cv2.line(near_layer, (x1, y1), (x2, y2), color, thickness)

    rain_layer = cv2.GaussianBlur(rain_layer, (0, 0), sigmaX=max(0.8, w / 900), sigmaY=max(0.8, h / 900))
    near_layer = cv2.GaussianBlur(near_layer, (0, 0), sigmaX=max(1.4, w / 520), sigmaY=max(1.4, h / 520))

    rain_bgr = cv2.merge([
        np.clip(rain_layer * 0.92, 0, 255),
        np.clip(rain_layer * 0.96, 0, 255),
        np.clip(rain_layer * 1.00, 0, 255)
    ]).astype(np.uint8)
    near_bgr = cv2.merge([
        np.clip(near_layer * 0.95, 0, 255),
        np.clip(near_layer * 0.98, 0, 255),
        np.clip(near_layer * 1.00, 0, 255)
    ]).astype(np.uint8)

    rainy = cv2.addWeighted(image_bgr, 1.0, rain_bgr, 0.45 + 0.65 * intensity, 0)
    rainy = cv2.addWeighted(rainy, 1.0, near_bgr, 0.22 + 0.42 * intensity, 0)

    haze = np.full((h, w, 3), (208, 216, 224), dtype=np.uint8)
    rainy = cv2.addWeighted(rainy, 1.0 - (0.04 + 0.08 * intensity), haze, 0.04 + 0.08 * intensity, 0)

    blur_kernel = 5 if intensity >= 0.5 else 3
    rainy = cv2.GaussianBlur(rainy, (blur_kernel, blur_kernel), 0)
    rainy = cv2.convertScaleAbs(rainy, alpha=max(0.70, 1.0 - 0.24 * intensity), beta=int(-16 * intensity))
    return rainy

def _tropical_aug_canopy_shadow(image_bgr, intensity=0.55):
    intensity = max(0.0, min(1.0, float(intensity)))
    h, w = image_bgr.shape[:2]
    shadow_mask = np.zeros((h, w), dtype=np.uint8)
    shadow_count = random.randint(1, 3)

    for _ in range(shadow_count):
        cx = random.randint(0, max(w - 1, 0))
        cy = random.randint(0, max(h - 1, 0))
        points_count = random.randint(5, 8)
        radius = random.randint(max(30, min(h, w) // 8), max(40, min(h, w) // 3))

        points = []
        for point_idx in range(points_count):
            theta = (2.0 * np.pi * point_idx / points_count) + random.uniform(-0.4, 0.4)
            local_r = radius * random.uniform(0.55, 1.0)
            px = int(cx + local_r * np.cos(theta))
            py = int(cy + local_r * np.sin(theta))
            points.append([px, py])

        polygon = np.array(points, dtype=np.int32)
        cv2.fillPoly(shadow_mask, [polygon], 255)

    shadow_mask = cv2.GaussianBlur(shadow_mask, (0, 0), sigmaX=max(6, min(h, w) / 22))
    shadow_strength = 0.8 * intensity

    output = image_bgr.astype(np.float32)
    mask = (shadow_mask.astype(np.float32) / 255.0)[:, :, None]
    output = output * (1.0 - (mask * shadow_strength))
    return np.clip(output, 0, 255).astype(np.uint8)

def _tropical_aug_wet_surface(image_bgr, intensity=0.55):
    intensity = max(0.0, min(1.0, float(intensity)))
    h, w = image_bgr.shape[:2]
    output = image_bgr.astype(np.float32)

    wet_strength = 0.56 * intensity
    gradient = np.linspace(0.0, 1.0, h, dtype=np.float32).reshape(h, 1, 1)
    output = output * (1.0 - wet_strength * gradient)

    reflection = cv2.GaussianBlur(output, (0, 0), sigmaX=max(1.5, w / 260), sigmaY=max(1.5, h / 260))
    blend_mask = np.clip((gradient - 0.28) * 1.75, 0.0, 1.0)
    reflect_blend = 0.48 * intensity
    output = output * (1.0 - reflect_blend * blend_mask) + reflection * (reflect_blend * blend_mask)

    puddle_mask = np.zeros((h, w), dtype=np.float32)
    puddle_count = random.randint(5, int(10 + 8 * intensity))
    for _ in range(puddle_count):
        cx = random.randint(int(w * 0.08), max(int(w * 0.92), 1))
        cy = random.randint(int(h * 0.52), max(int(h * 0.96), 1))
        axis_x = random.randint(max(18, w // 20), max(22, w // 9))
        axis_y = random.randint(max(8, h // 45), max(12, h // 20))
        angle = random.randint(-18, 18)
        cv2.ellipse(puddle_mask, (cx, cy), (axis_x, axis_y), angle, 0, 360, random.uniform(110.0, 220.0), -1)

    puddle_mask = cv2.GaussianBlur(puddle_mask, (0, 0), sigmaX=max(4, w / 130), sigmaY=max(3, h / 150))
    puddle_alpha = np.clip((puddle_mask / 255.0) * (0.14 + 0.26 * intensity), 0.0, 0.65)[:, :, None]

    flipped = cv2.flip(output, 0)
    flipped = cv2.GaussianBlur(flipped, (0, 0), sigmaX=max(1.2, w / 300), sigmaY=max(1.2, h / 300))
    output = output * (1.0 - puddle_alpha) + flipped * puddle_alpha

    specular = np.zeros((h, w), dtype=np.float32)
    for _ in range(random.randint(16, int(30 + 20 * intensity))):
        y = random.randint(int(h * 0.45), max(int(h * 0.95), 1))
        x = random.randint(0, max(w - 1, 0))
        radius = random.randint(max(4, w // 105), max(10, w // 30))
        cv2.circle(specular, (x, y), radius, random.uniform(85, 195), -1)
    specular = cv2.GaussianBlur(specular, (0, 0), sigmaX=max(3, w / 180))
    specular_bgr = cv2.merge([specular, specular, specular])

    output = np.clip(output + specular_bgr * (0.58 * intensity), 0, 255)
    return output.astype(np.uint8)

def _tropical_aug_fog_haze(image_bgr, intensity=0.55):
    intensity = max(0.0, min(1.0, float(intensity)))
    h, w = image_bgr.shape[:2]
    fog_layer = np.full((h, w, 3), 235, dtype=np.uint8)

    blur_sigma_x = max(1.2, w / 380) * (0.5 + 0.5 * intensity)
    blur_sigma_y = max(1.2, h / 380) * (0.5 + 0.5 * intensity)
    blurred = cv2.GaussianBlur(image_bgr, (0, 0), sigmaX=blur_sigma_x, sigmaY=blur_sigma_y)
    fog_base = 0.40 * intensity
    base = cv2.addWeighted(blurred, 1.0 - fog_base, fog_layer, fog_base, 0)

    vertical = np.linspace(0.0, 1.0, h, dtype=np.float32).reshape(h, 1, 1)
    density = np.clip((0.05 * intensity) + 0.35 * intensity * vertical, 0.0, 0.85)
    output = base.astype(np.float32) * (1.0 - density) + fog_layer.astype(np.float32) * density
    return np.clip(output, 0, 255).astype(np.uint8)

def _tropical_aug_low_light_noise(image_bgr, intensity=0.55):
    intensity = max(0.0, min(1.0, float(intensity)))
    alpha_val = max(0.40, 1.0 - 0.55 * intensity)
    beta_val = int(-22 * intensity)
    darkened = cv2.convertScaleAbs(image_bgr, alpha=alpha_val, beta=beta_val)
    noise_sigma = 20.0 * intensity
    noise = np.random.normal(0, noise_sigma, darkened.shape).astype(np.float32)
    noisy = darkened.astype(np.float32) + noise
    noisy = np.clip(noisy, 0, 255).astype(np.uint8)
    return cv2.GaussianBlur(noisy, (3, 3), 0)

def _enhance_for_second_pass(image_bgr):
    if image_bgr is None or image_bgr.size == 0:
        return image_bgr

    lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB)
    l_chan, a_chan, b_chan = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_enhanced = clahe.apply(l_chan)
    merged_lab = cv2.merge([l_enhanced, a_chan, b_chan])
    enhanced = cv2.cvtColor(merged_lab, cv2.COLOR_LAB2BGR)

    sharpen_kernel = np.array([
        [0, -1, 0],
        [-1, 5, -1],
        [0, -1, 0]
    ], dtype=np.float32)
    return cv2.filter2D(enhanced, -1, sharpen_kernel)

def _infer_detections_from_bgr(image_bgr):
    current_model = get_model()
    def _collect(results, source_image):
        parsed = []
        for result in results:
            for box in result.boxes:
                cls_id = int(box.cls[0])
                label = current_model.names.get(cls_id, 'unknown')
                conf = float(box.conf[0])

                if conf < _class_min_conf(label):
                    continue

                x1, y1, x2, y2 = box.xyxyn[0].tolist()
                x_min = max(min(x1, 1), 0)
                y_min = max(min(y1, 1), 0)
                x_max = max(min(x2, 1), 0)
                y_max = max(min(y2, 1), 0)
                width = max(x_max - x_min, 0)
                height = max(y_max - y_min, 0)
                bbox = {
                    "x": x_min,
                    "y": y_min,
                    "width": width,
                    "height": height,
                    "x2": x_max,
                    "y2": y_max
                }

                output_label = label
                output_conf = conf
                if (label or '').strip().lower() == 'pothole':
                    crack_label, crack_conf = _reanalyze_pothole_prediction(source_image, bbox, conf)
                    if crack_label:
                        output_label = crack_label
                        output_conf = crack_conf

                output_label = _normalize_label(output_label, output_conf)

                if INFER_CRACK_RELOCALIZE_ENABLED:
                    class_key = (output_label or '').strip().lower()
                    if class_key in {'crack', 'alligator_crack', 'longitudinal_crack'}:
                        relocalized = _relocalize_crack_bbox(current_model, source_image, bbox)
                        if isinstance(relocalized, dict):
                            output_label = str(relocalized.get('label') or output_label)
                            output_conf = float(relocalized.get('confidence') or output_conf)
                            if isinstance(relocalized.get('bbox'), dict):
                                bbox = relocalized['bbox']

                if INFER_CRACK_BBOX_REFINEMENT_ENABLED:
                    class_key = (output_label or '').strip().lower()
                    if class_key in {'crack', 'alligator_crack', 'longitudinal_crack'}:
                        refined_bbox = _refine_crack_bbox_norm(source_image, bbox)
                        if isinstance(refined_bbox, dict):
                            bbox = refined_bbox

                if INFER_SHADOW_GUARD_ENABLED:
                    class_key = (output_label or '').strip().lower()
                    if class_key == 'alligator_crack' and output_conf >= INFER_SHADOW_GUARD_ALLIGATOR_MIN_CONF:
                        region = _extract_region_from_bbox_norm(source_image, bbox)
                        if _looks_shadow_dominant(region):
                            # Conservative downgrade avoids overcommitting to subtype in shadow-dominant regions.
                            output_label = 'crack'

                if output_conf < _class_min_conf(output_label):
                    continue

                parsed.append({
                    'class': output_label,
                    'confidence': output_conf,
                    'bbox': bbox
                })
        return parsed

    first_results = current_model(image_bgr, conf=INFER_CONF, iou=INFER_IOU, classes=INFER_CLASSES)
    detections = _collect(first_results, image_bgr)
    if detections or not INFER_ENABLE_SECOND_PASS:
        return detections

    second_pass_input = _enhance_for_second_pass(image_bgr) if INFER_SECOND_PASS_CLAHE else image_bgr
    second_pass_conf = min(INFER_CONF, INFER_SECOND_PASS_CONF)
    second_results = current_model(second_pass_input, conf=second_pass_conf, iou=INFER_IOU, classes=INFER_CLASSES)
    return _collect(second_results, second_pass_input)

def _confidence_summary_from_detections(detections):
    top = _top_detection(detections)
    class_scores = {}
    for detection in detections or []:
        if not isinstance(detection, dict):
            continue
        class_key = _normalize_hazard_label(detection.get('class') or 'other')
        conf = float(detection.get('confidence') or 0.0)
        if conf <= 0:
            continue
        class_scores[class_key] = max(class_scores.get(class_key, 0.0), conf)

    if not top:
        return {
            'detected': False,
            'topClass': None,
            'topConfidence': 0.0,
            'numDetections': 0,
            'classScores': {}
        }
    return {
        'detected': True,
        'topClass': _normalize_hazard_label(top.get('class') or 'other'),
        'topConfidence': float(top.get('confidence') or 0.0),
        'numDetections': len(detections),
        'classScores': class_scores
    }

def _compute_augmentation_confidence(record_id: str, controls: dict = None):
    doc_ref = db.collection('hazard_records').document(record_id)
    snapshot = doc_ref.get()
    if not snapshot.exists:
        raise ValueError('recordId not found for confidence analysis')

    record = snapshot.to_dict() or {}
    media_url = (record.get('mediaURL') or '').strip()
    if not media_url:
        raise ValueError('Selected report has no mediaURL')

    original = _download_image_bgr(media_url)
    if original is None:
        raise ValueError('Could not download source image for confidence analysis')

    c = controls or {}
    intensity = float(c.get('intensity', 0.55))
    intensity = max(0.0, min(1.0, intensity))
    sun_glare_on = bool(c.get('sunGlare', True))
    shadow_on = bool(c.get('shadow', True))
    rain_on = bool(c.get('rain', False))
    wet_on = bool(c.get('wetSurface', False))
    fog_on = bool(c.get('fog', False))
    low_light_on = bool(c.get('lowLight', False))

    scenarios = {'original': original}
    if sun_glare_on:
        scenarios['sun_glare'] = _tropical_aug_sun_glare(original, intensity)
    if shadow_on:
        scenarios['canopy_shadow'] = _tropical_aug_canopy_shadow(original, intensity)
    if rain_on:
        scenarios['heavy_rain'] = _tropical_aug_monsoon_rain(original, intensity)
    if wet_on:
        scenarios['wet_surface_reflection'] = _tropical_aug_wet_surface(original, intensity)
    if fog_on:
        scenarios['fog_haze'] = _tropical_aug_fog_haze(original, intensity)
    if low_light_on:
        scenarios['low_light_noise'] = _tropical_aug_low_light_noise(original, intensity)

    def _run_scenario(item):
        scenario_name, scenario_image = item
        detections = _infer_detections_from_bgr(scenario_image)
        summary = _confidence_summary_from_detections(detections)
        # Encode once with detections overlaid (serves as both imageData + previewImage)
        preview = _encode_scenario_preview(scenario_image, detections)
        return {
            'scenario': scenario_name,
            'imageData': preview,
            'previewImage': preview,
            'detections': [
                {
                    'index': idx,
                    'class': det.get('class'),
                    'confidence': round(float(det.get('confidence') or 0.0), 4),
                    'bbox': det.get('bbox') or {}
                }
                for idx, det in enumerate(detections or [])
                if isinstance(det, dict)
            ],
            **summary
        }

    # Run all scenario inferences in parallel — cuts total time from N×T to ~T
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(scenarios)) as pool:
        results = list(pool.map(_run_scenario, scenarios.items()))

    consensus = _consensus_from_scenarios(results)

    return {
        'recordId': record_id,
        'scenarios': results,
        'consensus': consensus
    }

def _resolve_confidence_source_record_id(preferred_record_id: str = ''):
    preferred = (preferred_record_id or '').strip()
    if preferred:
        snapshot = db.collection('hazard_records').document(preferred).get()
        if snapshot.exists:
            record = snapshot.to_dict() or {}
            media_url = (record.get('mediaURL') or '').strip()
            if media_url:
                return preferred

    try:
        docs = (
            db.collection('hazard_records')
            .order_by('timestamp', direction=firestore.Query.DESCENDING)
            .limit(50)
            .stream()
        )
    except Exception as recent_query_error:
        # Fallback keeps confidence analysis available when timestamp ordering fails.
        print(f"[AUGMENT] Falling back to unordered confidence source scan: {recent_query_error}")
        docs = db.collection('hazard_records').limit(50).stream()

    for doc in docs:
        record = doc.to_dict() or {}
        media_url = (record.get('mediaURL') or '').strip()
        if media_url:
            return doc.id
    return ''

def _save_augmented_sample(dataset_root: Path, stem: str, image_bgr, labels):
    images_dir = dataset_root / 'train' / 'images'
    labels_dir = dataset_root / 'train' / 'labels'
    images_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)

    image_path = images_dir / f"{stem}.jpg"
    label_path = labels_dir / f"{stem}.txt"

    cv2.imwrite(str(image_path), image_bgr)
    with open(label_path, 'w', encoding='utf-8') as label_file:
        for class_id, x_center, y_center, width, height in labels:
            label_file.write(f"{class_id} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}\n")

    return str(image_path), str(label_path)

def _normalize_dataset_class(label: str):
    class_key = _normalize_hazard_label(label)
    if class_key not in HAZARD_CLASSES:
        return 'crack'
    return class_key

def _report_effective_hazard_class(report: dict, detections=None):
    report = report or {}
    if detections is None:
        detections = report.get('detections') or []

    final_class = _normalize_hazard_label(
        report.get('finalHazardClass')
        or (report.get('aiFeedback') or {}).get('finalClass')
        or ''
    )
    if final_class in HAZARD_CLASSES:
        return final_class

    top = _top_detection(detections) or {}
    predicted = _normalize_hazard_label(top.get('class') or 'crack')
    if predicted in HAZARD_CLASSES:
        return predicted
    return 'crack'


def _preprocess_image_clahe(input_path: str):
    """
    Create a CLAHE-enhanced, denoised copy of the image and return its temp path.
    Returns None on failure.
    """
    try:
        img = cv2.imread(input_path)
        if img is None:
            return None

        # Convert to YCrCb and apply CLAHE on luminance channel
        ycrcb = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
        y = ycrcb[:, :, 0]
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        y_eq = clahe.apply(y)
        ycrcb[:, :, 0] = y_eq
        img_eq = cv2.cvtColor(ycrcb, cv2.COLOR_YCrCb2BGR)

        # Optional denoise to remove sensor / compression noise
        try:
            img_eq = cv2.fastNlMeansDenoisingColored(img_eq, None, 10, 10, 7, 21)
        except Exception:
            # If denoising fails for any reason, continue with CLAHE result
            pass

        out_path = os.path.join(tempfile.gettempdir(), f"temp_enh_{uuid.uuid4().hex}.jpg")
        cv2.imwrite(out_path, img_eq, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        return out_path
    except Exception as e:
        print(f"[PREPROCESS] CLAHE preprocessing failed: {e}")
        return None


def _detect_from_path(model_obj, image_path: str):
    """
    Run the YOLO model on the image path and return (detections_list, cv_image).
    Detections list uses the same format as the upload endpoint expects.
    """
    detections = []
    cv_image = None
    try:
        cv_image = cv2.imread(image_path)
        results = model_obj(image_path, conf=INFER_CONF, iou=INFER_IOU, classes=INFER_CLASSES)

        for result in results:
            for box in result.boxes:
                try:
                    cls_id = int(box.cls[0])
                    label = model_obj.names.get(cls_id, 'unknown')
                    conf = float(box.conf[0])
                except Exception:
                    continue

                if conf < _class_min_conf(label):
                    continue

                x1, y1, x2, y2 = box.xyxyn[0].tolist()
                x_min = max(min(x1, 1), 0)
                y_min = max(min(y1, 1), 0)
                x_max = max(min(x2, 1), 0)
                y_max = max(min(y2, 1), 0)
                width = max(x_max - x_min, 0)
                height = max(y_max - y_min, 0)
                bbox = {
                    "x": x_min,
                    "y": y_min,
                    "width": width,
                    "height": height,
                    "x2": x_max,
                    "y2": y_max
                }

                output_label = label
                output_conf = conf

                if (label or '').strip().lower() == 'pothole':
                    try:
                        crack_label, crack_conf = _reanalyze_pothole_prediction(cv_image, bbox, conf)
                        if crack_label:
                            output_label = crack_label
                            output_conf = crack_conf
                    except Exception:
                        pass

                output_label = _normalize_label(output_label, output_conf)
                if output_conf < _class_min_conf(output_label):
                    continue

                detections.append({
                    "class": output_label,
                    "raw_class": label,
                    "confidence": output_conf,
                    "bbox": bbox
                })

    except Exception as e:
        print(f"[DETECT] model inference failed for {image_path}: {e}")

    return detections, cv_image

def _archive_image_bytes_by_class(image_bytes: bytes, record_id: str, hazard_class: str, source_tag: str):
    if not image_bytes:
        return None

    project_root = Path(__file__).resolve().parent.parent
    dataset_root = project_root / 'datasets' / 'road_hazards_combined'
    class_key = _normalize_dataset_class(hazard_class)
    images_dir = dataset_root / 'submitted_by_class' / class_key / 'images'
    images_dir.mkdir(parents=True, exist_ok=True)

    safe_record = ''.join(ch for ch in str(record_id or 'record') if ch.isalnum())[:24] or 'record'
    safe_source = ''.join(ch for ch in str(source_tag or 'event') if ch.isalnum())[:16] or 'event'
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d_%H%M%S')
    image_name = f"{safe_record}_{safe_source}_{timestamp}_{uuid.uuid4().hex[:8]}.jpg"
    image_path = images_dir / image_name

    with open(image_path, 'wb') as output:
        output.write(image_bytes)

    return str(image_path)

def _archive_local_image_to_dataset(local_image_path: str, record_id: str, hazard_class: str, source_tag: str = 'upload'):
    if not local_image_path or not os.path.exists(local_image_path):
        return None
    with open(local_image_path, 'rb') as input_file:
        image_bytes = input_file.read()
    return _archive_image_bytes_by_class(image_bytes, record_id, hazard_class, source_tag)

def _archive_remote_image_to_dataset(media_url: str, record_id: str, hazard_class: str, source_tag: str = 'feedback'):
    media = (media_url or '').strip()
    if not media:
        return None

    with urllib.request.urlopen(media, timeout=8) as response:
        image_bytes = response.read()
    return _archive_image_bytes_by_class(image_bytes, record_id, hazard_class, source_tag)

def _compute_dataset_label_counts():
    project_root = Path(__file__).resolve().parent.parent
    dataset_root = project_root / 'datasets' / 'road_hazards_combined'
    submitted_root = dataset_root / 'submitted_by_class'

    # Explicitly exclude 'other' per UI expectation.
    display_classes = [
        'pothole',
        'alligator_crack',
        'longitudinal_crack',
        'crack',
        'not_hazard',
    ]
    report_counts = {class_key: 0 for class_key in display_classes}
    report_total = 0

    report_docs = db.collection('hazard_records').stream()
    for doc in report_docs:
        payload = doc.to_dict() or {}
        if not (payload.get('mediaURL') or '').strip():
            continue
        class_key = _normalize_hazard_label(_report_effective_hazard_class(payload, payload.get('detections') or []))
        if class_key == 'other':
            continue
        if class_key not in report_counts:
            continue
        report_counts[class_key] = int(report_counts.get(class_key, 0)) + 1
        report_total += 1

    # Count files in local archive (if present)
    local_counts = {class_key: 0 for class_key in display_classes}
    for class_key in display_classes:
        images_dir = submitted_root / class_key / 'images'
        local_count = 0
        if images_dir.exists():
            local_count = sum(1 for path in images_dir.glob('*') if path.is_file())
        local_counts[class_key] = int(local_count)

    local_total = int(sum(local_counts.values()))

    # If a GCS bucket is configured and the local archive looks incomplete, prefer the bucket.
    gcs_bucket = os.getenv('DATASET_GCS_BUCKET', '').strip()
    if gcs_bucket and gcs_storage is not None and (local_total == 0 or local_total < report_total):
        try:
            client = gcs_storage.Client()
            bucket = client.bucket(gcs_bucket)
            gcs_counts = {class_key: 0 for class_key in display_classes}
            gcs_total = 0
            for class_key in display_classes:
                prefix = f'road_hazards_combined/submitted_by_class/{class_key}/images/'
                blobs = list(client.list_blobs(bucket, prefix=prefix))
                count = sum(1 for b in blobs if not b.name.endswith('/'))
                gcs_counts[class_key] = int(count)
                gcs_total += int(count)

            missing_archive_count = max(int(report_total) - int(gcs_total), 0)
            return {
                'counts': gcs_counts,
                'totalImages': gcs_total,
                'root': f'gs://{gcs_bucket}/road_hazards_combined/submitted_by_class',
                'reportCounts': report_counts,
                'reportTotalImages': int(report_total),
                'missingArchivedImages': int(missing_archive_count),
                'reportRoot': 'firestore:hazard_records',
                'updatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()
            }
        except Exception:
            # If GCS access fails, fall through to returning local counts.
            pass

    missing_archive_count = max(int(report_total) - int(local_total), 0)
    return {
        # Local archive counters are the real downloadable/training dataset size.
        'counts': local_counts,
        'totalImages': local_total,
        'root': str(submitted_root),
        # Firestore counters are kept separately for transparency in dashboard.
        'reportCounts': report_counts,
        'reportTotalImages': int(report_total),
        'missingArchivedImages': int(missing_archive_count),
        'reportRoot': 'firestore:hazard_records',
        'updatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()
    }

def _create_dataset_labels_zip(corrected_only: bool):
    project_root = Path(__file__).resolve().parent.parent
    submitted_root = project_root / 'datasets' / 'road_hazards_combined' / 'submitted_by_class'

    # Prefer GCS when available because the hosted container may only have a partial local archive.
    gcs_bucket = os.getenv('DATASET_GCS_BUCKET', '').strip()
    use_gcs = bool(gcs_bucket and gcs_storage is not None)

    with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as zip_file:
        zip_path = zip_file.name

    counts = {}
    total_files = 0
    with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        if use_gcs:
            try:
                client = gcs_storage.Client()
                bucket = client.bucket(gcs_bucket)
                for class_key in DATASET_LABEL_CLASSES:
                    prefix = f'road_hazards_combined/submitted_by_class/{class_key}/images/'
                    blobs = list(client.list_blobs(bucket, prefix=prefix))
                    class_count = 0
                    for blob in sorted(blobs, key=lambda b: b.name):
                        if blob.name.endswith('/'):
                            continue
                        filename = os.path.basename(blob.name)
                        if corrected_only and '_feedback_' not in filename.lower():
                            continue
                        try:
                            data = blob.download_as_bytes()
                            arcname = f"{class_key}/{filename}"
                            archive.writestr(arcname, data)
                            total_files += 1
                            class_count += 1
                        except Exception:
                            # skip unreadable blobs
                            continue
                    counts[class_key] = class_count
            except Exception:
                use_gcs = False
                counts = {}
                total_files = 0

        if not use_gcs:
            for class_key in DATASET_LABEL_CLASSES:
                images_dir = submitted_root / class_key / 'images'
                if not images_dir.exists():
                    counts[class_key] = 0
                    continue

                class_files = [path for path in sorted(images_dir.glob('*')) if path.is_file()]
                if corrected_only:
                    class_files = [path for path in class_files if '_feedback_' in path.name.lower()]

                counts[class_key] = len(class_files)
                for image_path in class_files:
                    arcname = f"{class_key}/{image_path.name}"
                    archive.write(str(image_path), arcname=arcname)
                    total_files += 1

    if total_files <= 0:
        try:
            os.remove(zip_path)
        except Exception:
            pass
        return None, counts, 0

    return zip_path, counts, total_files

def _augment_submitted_reports(max_items: int):
    project_root = Path(__file__).resolve().parent.parent
    dataset_root = project_root / 'datasets' / 'road_hazards_combined'
    now = datetime.datetime.now(datetime.timezone.utc)

    # Keep selection scan small for hosted requests to avoid proxy timeout.
    query_limit = max(max_items * 2, 5)
    try:
        docs = list(
            db.collection('hazard_records')
            .order_by('timestamp', direction=firestore.Query.DESCENDING)
            .limit(query_limit)
            .stream()
        )
    except Exception as query_error:
        print(f"[AUGMENT] Falling back to unordered report scan: {query_error}")
        docs = list(db.collection('hazard_records').limit(query_limit).stream())

    selected = []
    skipped = 0
    for doc in docs:
        record = doc.to_dict() or {}
        status = (record.get('status') or '').strip().lower().replace('_', ' ')
        if status in {'rejected', 'reject'}:
            skipped += 1
            continue

        media_url = (record.get('mediaURL') or '').strip()
        detections = record.get('detections') or []
        labels = []
        for detection in detections:
            normalized = _normalize_detection_for_label(detection)
            if normalized:
                labels.append(normalized)

        if not media_url:
            skipped += 1
            continue
        if not labels:
            skipped += 1
            continue

        selected.append((doc.id, media_url, labels))
        if len(selected) >= max_items:
            break

    generated = 0
    failed = 0
    variants = [variant for variant in AUGMENT_VARIANTS if variant in {'sun_glare', 'monsoon_rain', 'canopy_shadow'}]
    if not variants:
        variants = ['sun_glare']
    runtime_exceeded = False
    deadline_utc = now + datetime.timedelta(seconds=max(10.0, AUGMENT_MAX_RUNTIME_SEC))

    for record_id, media_url, labels in selected:
        if datetime.datetime.now(datetime.timezone.utc) >= deadline_utc:
            runtime_exceeded = True
            print(
                f"[AUGMENT] Runtime budget reached after {generated} samples; "
                f"remaining records skipped to avoid client timeout."
            )
            break

        try:
            image = _download_image_bgr(media_url, timeout_sec=AUGMENT_DOWNLOAD_TIMEOUT_SEC)
            if image is None:
                failed += 1
                continue

            augmented_images = {
                'sun_glare': _tropical_aug_sun_glare(image),
                'monsoon_rain': _tropical_aug_monsoon_rain(image),
                'canopy_shadow': _tropical_aug_canopy_shadow(image)
            }

            safe_record = ''.join(ch for ch in (record_id or 'record') if ch.isalnum())[:24] or 'record'
            suffix = uuid.uuid4().hex[:8]

            for variant in variants:
                stem = f"aug_{safe_record}_{variant}_{suffix}"
                _save_augmented_sample(dataset_root, stem, augmented_images[variant], labels)
                generated += 1
        except Exception as augmentation_error:
            print(f"[AUGMENT] Failed for {record_id}: {augmentation_error}")
            failed += 1

    return {
        'selectedReports': len(selected),
        'skippedReports': skipped,
        'generatedSamples': generated,
        'failedReports': failed,
        'variantsPerReport': len(variants),
        'runtimeExceeded': runtime_exceeded,
        'generatedAt': now.isoformat()
    }

def _export_pending_feedback_to_dataset(project_root: Path, batch_id: str):
    pending_docs = list(db.collection('training_feedback').where('usedForTraining', '==', False).stream())
    if not pending_docs:
        return {'processed': 0, 'skipped': 0, 'failed': 0}

    processed = 0
    skipped = 0
    failed = 0
    now = datetime.datetime.now()

    for doc in pending_docs:
        payload = doc.to_dict() or {}
        record_id = (payload.get('recordId') or '').strip() or doc.id
        media_url = (payload.get('mediaURL') or '').strip()
        final_class = _normalize_hazard_label(payload.get('finalClass') or 'other')
        detections = payload.get('detections') or []
        target_detection_index = payload.get('targetDetectionIndex')
        target_detection_bbox = payload.get('targetDetectionBBox') if isinstance(payload.get('targetDetectionBBox'), dict) else None
        target_detection_bboxes = payload.get('targetDetectionBBoxes') if isinstance(payload.get('targetDetectionBBoxes'), list) else None
        if target_detection_index is not None:
            try:
                target_detection_index = int(target_detection_index)
            except Exception:
                target_detection_index = None

        if not media_url:
            skipped += 1
            doc.reference.update({
                'usedForTraining': True,
                'usedAt': now,
                'retrainBatchId': batch_id,
                'trainingExport': {'status': 'skipped', 'reason': 'missing_media_url'}
            })
            continue

        try:
            image_path, label_path, sample_type, grouped_image_path, grouped_label_path, class_group = _write_feedback_sample(
                project_root=project_root,
                record_id=record_id,
                doc_id=doc.id,
                media_url=media_url,
                final_class=final_class,
                detections=detections,
                target_detection_index=target_detection_index,
                target_detection_bbox=target_detection_bbox,
                target_detection_bboxes=target_detection_bboxes
            )
            doc.reference.update({
                'usedForTraining': True,
                'usedAt': now,
                'retrainBatchId': batch_id,
                'trainingExport': {
                    'status': 'ok',
                    'sampleType': sample_type,
                    'classGroup': class_group,
                    'imagePath': image_path,
                    'labelPath': label_path,
                    'groupedImagePath': grouped_image_path,
                    'groupedLabelPath': grouped_label_path
                }
            })
            processed += 1
        except Exception as export_error:
            failed += 1
            doc.reference.update({
                'usedForTraining': True,
                'usedAt': now,
                'retrainBatchId': batch_id,
                'trainingExport': {
                    'status': 'failed',
                    'error': str(export_error),
                    'updatedAt': now
                }
            })

    return {'processed': processed, 'skipped': skipped, 'failed': failed}

def _run_auto_retrain_job(pending_count_snapshot, started_at):
    global _retrain_running, _last_retrain_started_at
    project_root = Path(__file__).resolve().parent.parent
    train_script = project_root / 'train_multi_class.py'
    resume_checkpoint = project_root / 'runs' / 'detect' / 'road_hazards_multi' / 'weights' / 'last.pt'
    batch_id = uuid.uuid4().hex

    try:
        print(f"[AUTO-RETRAIN] Starting background retrain with {pending_count_snapshot} pending feedback samples")
        _persist_auto_retrain_state({
            'running': True,
            'lastState': 'running',
            'lastStartedAt': started_at,
            'pendingCountSnapshot': pending_count_snapshot,
            'batchId': batch_id,
            'error': None
        })

        export_stats = _export_pending_feedback_to_dataset(project_root, batch_id)
        print(f"[AUTO-RETRAIN] Feedback export stats: {export_stats}")

        if int(export_stats.get('processed', 0)) <= 0:
            _persist_auto_retrain_state({
                'running': False,
                'lastState': 'skipped_no_exportable_samples',
                'lastCompletedAt': datetime.datetime.now(datetime.timezone.utc),
                'exportStats': export_stats,
                'pendingFeedbackCount': _count_pending_feedback()
            })
            return

        command = [
            sys.executable,
            str(train_script),
            '--epochs', str(AUTO_RETRAIN_EPOCHS),
            '--batch', str(AUTO_RETRAIN_BATCH),
            '--imgsz', str(AUTO_RETRAIN_IMGSZ),
            '--data-yaml', 'datasets/road_hazards_combined/data_multiclass.yaml'
        ]
        resume_used = AUTO_RETRAIN_RESUME and resume_checkpoint.exists()
        if resume_used:
            command.append('--resume')

        run_result = subprocess.run(command, cwd=str(project_root), check=False)
        print(f"[AUTO-RETRAIN] Triggered: {' '.join(command)}")

        completed_state = 'completed' if run_result.returncode == 0 else f'failed_exit_{run_result.returncode}'
        _persist_auto_retrain_state({
            'running': False,
            'lastState': completed_state,
            'lastCompletedAt': datetime.datetime.now(datetime.timezone.utc),
            'returnCode': int(run_result.returncode),
            'resumeEnabled': AUTO_RETRAIN_RESUME,
            'resumeUsed': bool(resume_used),
            'resumeCheckpoint': str(resume_checkpoint),
            'exportStats': export_stats,
            'pendingFeedbackCount': _count_pending_feedback()
        })
    except Exception as e:
        print(f"[AUTO-RETRAIN] Failed to start retrain: {e}")
        _persist_auto_retrain_state({
            'running': False,
            'lastState': 'failed_exception',
            'lastCompletedAt': datetime.datetime.now(datetime.timezone.utc),
            'error': str(e),
            'pendingFeedbackCount': _count_pending_feedback()
        })
    finally:
        with _retrain_lock:
            _retrain_running = False
            _last_retrain_started_at = started_at

def _maybe_trigger_auto_retrain():
    global _retrain_running, _last_retrain_started_at
    if not AUTO_RETRAIN_ON_FEEDBACK:
        return False, 'disabled'

    now = datetime.datetime.now(datetime.timezone.utc)
    with _retrain_lock:
        if _retrain_running:
            return False, 'already_running'

        if _sync_running_from_persisted_state():
            _retrain_running = True
            return False, 'already_running'

        cooldown_remaining = _retrain_cooldown_remaining_seconds(now)
        if cooldown_remaining > 0:
            return False, f'cooldown_{cooldown_remaining}'

        pending_count = _count_pending_feedback()
        if pending_count < AUTO_RETRAIN_MIN_FEEDBACK:
            return False, f'need_{AUTO_RETRAIN_MIN_FEEDBACK}_have_{pending_count}'

        _retrain_running = True
        _last_retrain_started_at = now

    _persist_auto_retrain_state({
        'running': True,
        'lastState': 'queued',
        'lastStartedAt': now,
        'pendingCountSnapshot': pending_count,
        'error': None
    })

    thread = threading.Thread(
        target=_run_auto_retrain_job,
        args=(pending_count, now),
        daemon=True
    )
    thread.start()
    return True, f'triggered_with_{pending_count}'

def _retrain_cooldown_remaining_seconds(now: datetime.datetime | None = None):
    if AUTO_RETRAIN_COOLDOWN_MIN <= 0:
        return 0

    if now is None:
        now = datetime.datetime.now(datetime.timezone.utc)
    else:
        now = _as_utc(now)

    last_started = _as_utc(_last_retrain_started_at)
    if last_started is None:
        return 0

    elapsed_seconds = (now - last_started).total_seconds()
    if elapsed_seconds < 0:
        return 0

    total_cooldown = AUTO_RETRAIN_COOLDOWN_MIN * 60
    remaining = int(total_cooldown - elapsed_seconds)
    return max(remaining, 0)

def _current_auto_retrain_status():
    global _retrain_running
    persisted = _read_auto_retrain_state()
    persisted_last_started = _to_datetime(persisted.get('lastStartedAt'))
    persisted_last_completed = _to_datetime(persisted.get('lastCompletedAt'))

    with _retrain_lock:
        retrain_running = bool(_retrain_running)

    if not retrain_running and _sync_running_from_persisted_state():
        retrain_running = True
        with _retrain_lock:
            _retrain_running = True

    active_last_started = _last_retrain_started_at or persisted_last_started
    pending_feedback = _count_pending_feedback()
    cooldown_remaining = _retrain_cooldown_remaining_seconds()
    retrain_ready = (
        AUTO_RETRAIN_ON_FEEDBACK
        and pending_feedback >= AUTO_RETRAIN_MIN_FEEDBACK
        and not retrain_running
        and cooldown_remaining == 0
    )

    return {
        'enabled': AUTO_RETRAIN_ON_FEEDBACK,
        'minFeedback': AUTO_RETRAIN_MIN_FEEDBACK,
        'cooldownMinutes': AUTO_RETRAIN_COOLDOWN_MIN,
        'epochs': AUTO_RETRAIN_EPOCHS,
        'resumeEnabled': AUTO_RETRAIN_RESUME,
        'resumeUsed': bool(persisted.get('resumeUsed', False)),
        'resumeCheckpoint': persisted.get('resumeCheckpoint'),
        'running': retrain_running,
        'ready': retrain_ready,
        'lastStartedAt': _to_iso(active_last_started),
        'lastCompletedAt': _to_iso(persisted_last_completed),
        'lastState': persisted.get('lastState') or ('running' if retrain_running else 'idle'),
        'pendingFeedbackCount': pending_feedback,
        'pendingCountSnapshot': int(persisted.get('pendingCountSnapshot') or 0),
        'cooldownRemainingSec': cooldown_remaining,
        'batchId': persisted.get('batchId')
    }

def _upsert_status_feedback(record_id: str, new_status: str, report: dict, now: datetime.datetime):
    """Status actions should not create retraining samples.

    Verified/rejected/requested/in-progress updates are operational workflow changes,
    while retraining data must come from the explicit correction feedback form.
    """
    return True


def _normalize_status_key(value: str):
    return (value or '').strip().lower().replace('-', ' ').replace('_', ' ')


def _repair_portal_url(token: str):
    base = PUBLIC_BASE_URL or (request.host_url or '').rstrip('/')
    return f"{base}/api/repair/partner/{token}"


def _build_repair_event(action: str, actor: str, note: str, now: datetime.datetime):
    return {
        'id': uuid.uuid4().hex,
        'action': action,
        'actor': actor,
        'note': note,
        'at': now.isoformat()
    }


def _append_repair_event_history(doc_ref, report: dict, event: dict | None, record_id: str = ''):
    if not isinstance(event, dict) or not event:
        return
    payload = report if isinstance(report, dict) else {}
    existing = payload.get('repairEvents') if isinstance(payload.get('repairEvents'), list) else []
    sanitized = [item for item in existing if isinstance(item, dict)]
    sanitized.append(event)
    try:
        doc_ref.update({'repairEvents': sanitized[-50:]})
    except Exception as history_error:
        rid = record_id or payload.get('recordId') or 'unknown'
        print(f"[REPAIR-EVENTS] Failed to update repairEvents for {rid}: {history_error}")


def _store_partner_attachment(report_id: str, upload_file, purpose: str = 'complete'):
    if not upload_file or not getattr(upload_file, 'filename', ''):
        return None

    file_bytes = upload_file.read()
    if not file_bytes:
        return None

    suffix = Path(upload_file.filename).suffix.lower()
    if suffix not in {'.jpg', '.jpeg', '.png', '.webp', '.gif'}:
        suffix = '.jpg'

    blob_name = f"hazards/partner_proofs/{report_id}_{purpose}_{uuid.uuid4().hex}{suffix}"
    blob = bucket.blob(blob_name)
    blob.upload_from_string(file_bytes, content_type=upload_file.mimetype or 'application/octet-stream')
    try:
        blob.make_public()
    except Exception as e:
        print(f"[STORAGE] Could not make partner attachment public for {blob_name}: {e}")
    return {
        'url': blob.public_url,
        'path': blob_name,
        'size': len(file_bytes)
    }


def _send_repair_email(to_email: str, subject: str, body: str):
    """Send repair request email via SMTP when enabled.

    Returns a dict with keys: enabled, sent, message.
    """
    if not AUTO_REPAIR_EMAIL_ENABLED:
        return {'enabled': False, 'sent': False, 'message': 'Auto email disabled by config.'}

    if not SMTP_USERNAME or not SMTP_PASSWORD:
        return {'enabled': True, 'sent': False, 'message': 'SMTP credentials are not configured.'}

    try:
        msg = EmailMessage()
        msg['From'] = SMTP_FROM
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.set_content(body)

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as smtp:
            if SMTP_USE_TLS:
                smtp.starttls()
            smtp.login(SMTP_USERNAME, SMTP_PASSWORD)
            smtp.send_message(msg)

        return {'enabled': True, 'sent': True, 'message': f'Email sent to {to_email}.'}
    except Exception as exc:
        print(f"[REPAIR-EMAIL] send failed: {exc}")
        return {'enabled': True, 'sent': False, 'message': str(exc)}





def _send_reporter_update_email(to_email: str, subject: str, body: str):
    recipient = (to_email or '').strip().lower()
    if not REPORTER_UPDATE_EMAIL_ENABLED:
        return {'enabled': False, 'sent': False, 'message': 'Reporter update email disabled by config.'}
    if not recipient:
        return {'enabled': True, 'sent': False, 'message': 'No reporter email provided.'}
    if not SMTP_USERNAME or not SMTP_PASSWORD:
        return {'enabled': True, 'sent': False, 'message': 'SMTP credentials are not configured.'}

    try:
        msg = EmailMessage()
        msg['From'] = SMTP_FROM
        msg['To'] = recipient
        msg['Subject'] = subject
        msg.set_content(body)

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as smtp:
            if SMTP_USE_TLS:
                smtp.starttls()
            smtp.login(SMTP_USERNAME, SMTP_PASSWORD)
            smtp.send_message(msg)

        return {'enabled': True, 'sent': True, 'message': f'Email sent to {recipient}.', 'to': recipient}
    except Exception as exc:
        print(f"[REPORTER-EMAIL] send failed: {exc}")
        return {'enabled': True, 'sent': False, 'message': str(exc), 'to': recipient}





def _notify_reporter_status_update(record_id: str, report: dict, workflow: dict, doc_ref, event_key: str, extra_note: str = ''):
    payload = report or {}
    contact = payload.get('reporterContact') if isinstance(payload.get('reporterContact'), dict) else {}
    normalized_event = (event_key or '').strip().lower().replace(' ', '_')
    if normalized_event not in {'in_progress', 'fixed', 'rejected'}:
        return {
            'attempted': False,
            'reason': 'invalid_event',
            'email': {'sent': False, 'message': 'Unsupported reporter notification event.'},
            'sms': {'sent': False, 'message': 'Unsupported reporter notification event.'}
        }

    notified_value = ((payload.get('reporterNotifications') or {}).get(normalized_event) or {}).get('notifiedAt')
    already_notified_at = (_to_iso(notified_value) or (str(notified_value or '').strip()))
    opted_in = bool(contact.get('optIn'))
    email = (contact.get('email') or '').strip().lower()

    if already_notified_at:
        return {
            'attempted': False,
            'reason': 'already_notified',
            'notifiedAt': already_notified_at,
            'email': {'sent': False, 'message': 'Skipped duplicate send.'}
        }

    if not opted_in:
        return {
            'attempted': False,
            'reason': 'reporter_not_opted_in',
            'email': {'sent': False, 'message': 'Reporter did not opt in.'}
        }

    if not email:
        return {
            'attempted': False,
            'reason': 'missing_contact',
            'email': {'sent': False, 'message': 'No reporter email provided.'}
        }

    location_label = ((payload.get('location') or {}).get('address') or 'Unknown location').strip()
    hazard_class = (payload.get('finalHazardClass') or 'road hazard').replace('_', ' ')
    in_progress_at = (workflow or {}).get('acceptedAt') or datetime.datetime.now(datetime.timezone.utc).isoformat()
    completed_at = (workflow or {}).get('completedAt') or datetime.datetime.now(datetime.timezone.utc).isoformat()

    if normalized_event == 'in_progress':
        subject = f"RoadHazard Update: Report #{record_id[:8]} is in progress"
        email_body = (
            "Hello,\n\n"
            "Your submitted road hazard report has been accepted and is now in progress.\n\n"
            f"Report ID: {record_id}\n"
            f"Hazard: {hazard_class}\n"
            f"Location: {location_label}\n"
            f"Started at: {in_progress_at}\n\n"
            "We will notify you again when the repair is completed.\n"
            "Road Hazard Management System"
        )
    elif normalized_event == 'rejected':
        rejected_at = (workflow or {}).get('rejectedAt') or datetime.datetime.now(datetime.timezone.utc).isoformat()
        subject = f"RoadHazard Update: Your report #{record_id[:8]} has been reviewed"
        reason_line = f"\nReason: {extra_note.strip()}\n" if extra_note and extra_note.strip() else ''
        email_body = (
            "Hello,\n\n"
            "Thank you for submitting a road hazard report. After review, your report has been rejected by the authority team.\n\n"
            f"Report ID: {record_id}\n"
            f"Hazard: {hazard_class}\n"
            f"Location: {location_label}\n"
            f"Reviewed at: {rejected_at}\n"
            f"{reason_line}\n"
            "If you believe this is an error, you may submit a new report with a clearer photo.\n"
            "Road Hazard Management System"
        )
    else:
        subject = f"RoadHazard Update: Report #{record_id[:8]} marked as fixed"
        email_body = (
            "Hello,\n\n"
            "Your submitted road hazard report has been updated as completed by the repair partner.\n\n"
            f"Report ID: {record_id}\n"
            f"Hazard: {hazard_class}\n"
            f"Location: {location_label}\n"
            f"Completed at: {completed_at}\n\n"
            "Thank you for helping improve road safety.\n"
            "Road Hazard Management System"
        )

    email_result = _send_reporter_update_email(email, subject, email_body)

    delivery_ok = bool(email_result.get('sent'))
    notification_doc = {
        'attemptedAt': datetime.datetime.now(datetime.timezone.utc),
        'optIn': opted_in,
        'email': {
            'to': email,
            'enabled': bool(email_result.get('enabled')),
            'sent': bool(email_result.get('sent')),
            'message': email_result.get('message')
        },
        'deliverySucceeded': delivery_ok
    }
    if delivery_ok:
        notification_doc['notifiedAt'] = datetime.datetime.now(datetime.timezone.utc)

    try:
        doc_ref.update({f'reporterNotifications.{normalized_event}': notification_doc})
    except Exception as update_error:
        print(f"[REPORTER-NOTIFY] Failed to persist notification status for {record_id}: {update_error}")

    return {
        'attempted': True,
        'deliverySucceeded': delivery_ok,
        'email': email_result
    }


def _notify_reporter_issue_fixed(record_id: str, report: dict, workflow: dict, doc_ref):
    return _notify_reporter_status_update(record_id, report, workflow, doc_ref, event_key='fixed')


def _notify_reporter_in_progress(record_id: str, report: dict, workflow: dict, doc_ref):
    return _notify_reporter_status_update(record_id, report, workflow, doc_ref, event_key='in_progress')


def _notify_reporter_rejected(record_id: str, report: dict, workflow: dict, doc_ref, rejection_note: str = ''):
    return _notify_reporter_status_update(record_id, report, workflow, doc_ref, event_key='rejected', extra_note=rejection_note)


def _compose_repair_workflow(report: dict, target_state: str, actor: str, note: str = '', contractor_email: str = '', contractor_org: dict | None = None):
    now = datetime.datetime.now(datetime.timezone.utc)
    workflow = report.get('repairWorkflow') or {}
    if not isinstance(workflow, dict):
        workflow = {}

    token = str(workflow.get('partnerToken') or uuid.uuid4().hex)
    events = workflow.get('events') if isinstance(workflow.get('events'), list) else []
    state = _normalize_status_key(target_state)
    display_state = {
        'requested': 'Requested',
        'in progress': 'In Progress',
        'completed': 'Completed',
        'rejected': 'Rejected'
    }.get(state, target_state)

    workflow.update({
        'state': display_state,
        'partnerToken': token,
        'partnerPortalUrl': _repair_portal_url(token),
        'updatedAt': now.isoformat()
    })

    if isinstance(contractor_org, dict):
        org_name = (contractor_org.get('name') or '').strip()
        org_id = (contractor_org.get('id') or '').strip()
        org_type = (contractor_org.get('type') or '').strip()
        org_coverage = (contractor_org.get('coverage') or '').strip()
        org_email = (contractor_org.get('email') or '').strip().lower()
        org_phone = (contractor_org.get('phone') or '').strip()
        org_contact_person = (contractor_org.get('contactPerson') or '').strip()
        if org_name:
            workflow['contractorOrganizationName'] = org_name
        if org_id:
            workflow['contractorOrganizationId'] = org_id
        if org_type:
            workflow['contractorOrganizationType'] = org_type
        if org_coverage:
            workflow['contractorOrganizationCoverage'] = org_coverage
        if org_email:
            workflow['contractorOrganizationEmail'] = org_email
        if org_phone:
            workflow['contractorOrganizationPhone'] = org_phone
        if org_contact_person:
            workflow['contractorOrganizationContactPerson'] = org_contact_person

    # Use the assigned org email if available, otherwise fall back to the simulation inbox.
    assigned_org_email = (workflow.get('contractorOrganizationEmail') or '').strip().lower()
    workflow['contractorEmail'] = assigned_org_email if assigned_org_email else DEFAULT_CONTRACTOR_EMAIL

    if state == 'requested' and not workflow.get('requestedAt'):
        workflow['requestedAt'] = now.isoformat()
    if state == 'in progress' and not workflow.get('acceptedAt'):
        workflow['acceptedAt'] = now.isoformat()
    if state == 'completed' and not workflow.get('completedAt'):
        workflow['completedAt'] = now.isoformat()
    if state == 'rejected' and not workflow.get('rejectedAt'):
        workflow['rejectedAt'] = now.isoformat()

    event_action = {
        'requested': 'request_sent',
        'in progress': 'accepted',
        'completed': 'completed',
        'rejected': 'rejected'
    }.get(state, 'updated')
    event_note = note or {
        'requested': 'Repair request submitted to contractor.',
        'in progress': 'Contractor accepted request and started work.',
        'completed': 'Contractor marked repair as completed.',
        'rejected': 'Contractor rejected the repair request.'
    }.get(state, 'Repair workflow updated.')

    event = _build_repair_event(event_action, actor, event_note, now)
    events.append(event)
    workflow['events'] = events[-20:]
    workflow['lastEvent'] = event
    return workflow


def _find_report_by_partner_token(token_value: str):
        matches = list(
                db.collection('hazard_records')
                .where('repairWorkflow.partnerToken', '==', token_value)
                .limit(1)
                .stream()
        )
        if not matches:
                return None, None
        snapshot = matches[0]
        return snapshot, (snapshot.to_dict() or {})


def _format_class_name(class_name: str) -> str:
    """Convert snake_case class names to Title Case (e.g., alligator_crack -> Alligator Crack)"""
    return ' '.join(word.capitalize() for word in str(class_name).split('_'))

def _partner_portal_html(report_id: str, report: dict, token_value: str, message: str = '', level: str = 'info'):
        workflow = report.get('repairWorkflow') if isinstance(report.get('repairWorkflow'), dict) else {}
        current_status = (report.get('status') or workflow.get('state') or 'Requested')
        contractor = DEFAULT_CONTRACTOR_EMAIL
        contractor_org_name = (workflow.get('contractorOrganizationName') or 'Simulation Contractor (Malaysia)').strip()
        contractor_org_type = (workflow.get('contractorOrganizationType') or 'Assigned contractor organization').strip()
        contractor_org_coverage = (workflow.get('contractorOrganizationCoverage') or 'Selected by admin during request').strip()
        contractor_org_email = (workflow.get('contractorOrganizationEmail') or contractor).strip().lower()
        contractor_org_phone = (workflow.get('contractorOrganizationPhone') or 'N/A').strip()
        contractor_org_contact = (workflow.get('contractorOrganizationContactPerson') or 'Operations Desk').strip()
        hazard_class = _format_class_name(report.get('finalHazardClass') or 'unknown')
        description = report.get('description') or 'No description provided'
        location_data = report.get('location') or {}
        location = location_data.get('address') or 'Unknown location'
        hazard_lat = _safe_float(location_data.get('latitude'))
        hazard_lng = _safe_float(location_data.get('longitude'))
        media_url = (report.get('mediaURL') or '').strip()
        contractor_photo_url = (workflow.get('contractorPhotoURL') or workflow.get('completedPhotoURL') or '').strip()
        contractor_note = (workflow.get('contractorNote') or workflow.get('completionNote') or '').strip()
        token_js = json.dumps(token_value)

        has_coords = hazard_lat is not None and hazard_lng is not None
        gmaps_url = f"https://www.google.com/maps?q={hazard_lat},{hazard_lng}" if has_coords else ''
        waze_url = f"https://waze.com/ul?ll={hazard_lat},{hazard_lng}&navigate=yes" if has_coords else ''
        map_block = f"""
        <div class="card" style="margin-top:12px;">
            <h3 class="title">Hazard Location</h3>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <a href="{html.escape(gmaps_url)}" target="_blank" rel="noopener noreferrer"
                   style="flex:1;min-width:140px;display:inline-block;text-align:center;padding:10px 12px;border-radius:10px;background:#2563eb;color:#fff;font-weight:700;text-decoration:none;">
                   Open in Google Maps
                </a>
                <a href="{html.escape(waze_url)}" target="_blank" rel="noopener noreferrer"
                   style="flex:1;min-width:140px;display:inline-block;text-align:center;padding:10px 12px;border-radius:10px;background:#05c8f0;color:#0f172a;font-weight:700;text-decoration:none;">
                   Open in Waze
                </a>
            </div>
        </div>""" if has_coords else """
        <div class="card" style="margin-top:12px;">
            <h3 class="title">Hazard Location</h3>
            <div style="color:#64748b;padding:12px 0;">No GPS coordinates available for this report.</div>
        </div>"""

        normalized_status = str(current_status).strip().lower().replace('_', ' ')
        can_accept = normalized_status in {'requested', 'verified'}
        can_reject = normalized_status in {'requested', 'verified'}
        can_complete = normalized_status in {'in progress', 'in_progress'}
        accept_disabled = 'disabled' if not can_accept else ''
        reject_disabled = 'disabled' if not can_reject else ''
        complete_disabled = 'disabled' if not can_complete else ''

        badge_color = {
                'success': '#14532d',
                'error': '#991b1b',
                'info': '#1e3a8a'
        }.get(level, '#1e3a8a')

        latest_events = (workflow.get('events') or [])[-5:]
        event_items = ''.join([
                f"<li><strong>{html.escape(str(event.get('action') or 'updated').replace('_', ' '))}</strong>"
                f" by {html.escape(str(event.get('actor') or 'system'))}"
                f" at {html.escape(str(event.get('at') or 'unknown time'))}</li>"
                for event in reversed(latest_events)
        ]) or '<li>No events yet.</li>'

        image_block = (
                f'<img src="{html.escape(media_url)}" alt="Hazard" class="clickable-image js-expandable-image" data-full-src="{html.escape(media_url)}" data-caption="Original hazard photo" />'
                if media_url else '<div style="color:#64748b;">No image available.</div>'
        )
        contractor_photo_block = (
                f'<img src="{html.escape(contractor_photo_url)}" alt="Contractor completion photo" class="clickable-image js-expandable-image" data-full-src="{html.escape(contractor_photo_url)}" data-caption="Contractor completion photo" />'
                if contractor_photo_url else '<div style="color:#64748b;">No contractor photo uploaded yet.</div>'
        )
        contractor_note_block = ''
        if contractor_note:
                safe_note = html.escape(contractor_note)
                contractor_note_block = f'<div style="margin-top:8px;color:#334155;"><strong>Reply note:</strong> {safe_note}</div>'
        message_block = f'<div style="margin-bottom:12px;padding:10px 12px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;color:{badge_color};font-weight:600;">{html.escape(message)}</div>' if message else ''

        return f"""
<!doctype html>
<html>
    <head>
        <meta charset=\"utf-8\" />
        <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
        <title>RoadHazard Contractor Portal</title>
        <style>
            :root {{
                --bg: #eff4fb;
                --panel: #ffffff;
                --border: #dbe3ee;
                --text: #0f172a;
                --muted: #64748b;
            }}
            * {{ box-sizing: border-box; }}
            body {{ margin: 0; font-family: Segoe UI, Arial, sans-serif; color: var(--text); background: linear-gradient(180deg, #e9f1ff 0%, var(--bg) 100%); }}
            .wrap {{ max-width: 1120px; margin: 18px auto; padding: 0 12px; }}
            .hero {{ border-radius: 16px; background: linear-gradient(135deg, #0f172a, #1d4ed8); color: #fff; padding: 16px 18px; margin-bottom: 12px; }}
            .hero h1 {{ margin: 0; font-size: 26px; }}
            .hero .meta {{ margin-top: 6px; opacity: 0.92; }}
            .pill {{ display: inline-block; margin-right: 8px; margin-top: 8px; padding: 6px 10px; border-radius: 999px; font-size: 12px; background: rgba(255,255,255,0.15); }}
            .status-line {{ margin-top: 10px; font-size: 13px; color: #f8fafc; font-weight: 600; }}
            .grid {{ display: grid; grid-template-columns: 1.2fr 1fr; gap: 12px; }}
            @media (max-width: 900px) {{ .grid {{ grid-template-columns: 1fr; }} }}
            .card {{ background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 14px; }}
            .title {{ margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }}
            .kv {{ display: grid; gap: 8px; }}
            .row {{ display: flex; justify-content: space-between; gap: 10px; border-bottom: 1px solid #edf1f6; padding-bottom: 6px; }}
            .row:last-child {{ border-bottom: 0; }}
            .k {{ color: var(--muted); font-size: 13px; }}
            .v {{ font-weight: 600; text-align: right; }}
            .actions {{ display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; margin-top: 12px; align-items: stretch; }}
            @media (max-width: 800px) {{ .actions {{ grid-template-columns: 1fr; }} }}
            .action {{ border: 1px solid var(--border); border-radius: 14px; padding: 12px; background: #fff; display: flex; flex-direction: column; gap: 10px; height: 100%; }}
            .action h4 {{ margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }}
            .action p {{ margin: 0; font-size: 12px; color: #64748b; }}
            .action.accept-only .spacer {{ flex: 1; }}
            .action textarea, .action input[type=file] {{ width: 100%; border: 1px solid #cbd5e1; border-radius: 10px; padding: 8px 10px; font: inherit; margin-bottom: 0; max-width: 100%; }}
            .action textarea {{ resize: vertical; min-height: 108px; }}
            .action .btn {{ margin-top: auto; }}
            .btn {{ border: 0; border-radius: 10px; padding: 10px 12px; color: #fff; font-weight: 700; cursor: pointer; width: 100%; }}
            .btn[disabled] {{ opacity: 0.62; cursor: not-allowed; }}
            .accept {{ background: #2563eb; }}
            .reject {{ background: #dc2626; }}
            .complete {{ background: #16a34a; }}
            .feedback {{ margin-top: 10px; padding: 10px 12px; border-radius: 10px; border: 1px solid #dbe3ee; background: #f8fafc; color: #1e293b; display: none; }}
            .feedback.show {{ display: block; }}
            .feedback.success {{ border-color: #86efac; background: #f0fdf4; color: #14532d; }}
            .feedback.error {{ border-color: #fecaca; background: #fef2f2; color: #991b1b; }}
            .clickable-image {{ width:100%;height:auto;max-height:430px;object-fit:cover;border-radius:14px;border:1px solid #dbe3ee; cursor: zoom-in; transition: transform .18s ease, box-shadow .18s ease; }}
            .clickable-image:hover {{ transform: translateY(-2px); box-shadow: 0 10px 24px rgba(15, 23, 42, 0.15); }}
            .timeline {{ margin-top: 12px; }}
            .timeline ul {{ margin: 8px 0 0; padding-left: 18px; color: #334155; }}
            .footer {{ margin-top: 10px; font-size: 12px; color: #64748b; text-align: right; }}
            .image-modal {{ position: fixed; inset: 0; background: rgba(2, 6, 23, 0.85); display: none; align-items: center; justify-content: center; padding: 16px; z-index: 9999; }}
            .image-modal.show {{ display: flex; }}
            .image-modal-inner {{ max-width: min(1200px, 96vw); max-height: 92vh; width: 100%; }}
            .image-modal-img {{ width: 100%; max-height: 82vh; object-fit: contain; border-radius: 10px; border: 1px solid rgba(226, 232, 240, 0.25); background: #020617; }}
            .image-modal-caption {{ margin-top: 8px; color: #e2e8f0; font-size: 13px; text-align: center; }}
            .image-modal-close {{ position: absolute; top: 14px; right: 14px; border: 0; border-radius: 999px; width: 38px; height: 38px; cursor: pointer; font-size: 22px; color: #0f172a; background: #f8fafc; }}
            .confirm-modal {{ position: fixed; inset: 0; background: rgba(2, 6, 23, 0.52); display: none; align-items: center; justify-content: center; padding: 16px; z-index: 10000; }}
            .confirm-modal.show {{ display: flex; }}
            .confirm-card {{ width: min(460px, 96vw); background: #fff; border: 1px solid #dbe3ee; border-radius: 14px; box-shadow: 0 18px 50px rgba(15, 23, 42, 0.25); padding: 16px; }}
            .confirm-title {{ margin: 0 0 8px; font-size: 18px; color: #0f172a; }}
            .confirm-text {{ margin: 0; color: #334155; line-height: 1.45; }}
            .confirm-actions {{ margin-top: 14px; display: flex; gap: 10px; justify-content: flex-end; }}
            .confirm-btn {{ border: 0; border-radius: 9px; padding: 9px 14px; font-weight: 700; cursor: pointer; }}
            .confirm-cancel {{ background: #e2e8f0; color: #1e293b; }}
            .confirm-danger {{ background: #dc2626; color: #fff; }}
        </style>
    </head>
    <body>
        <div class=\"wrap\">
            <div class=\"hero\">
                <h1>Repair Partner Portal</h1>
                <div class=\"meta\">Record #{html.escape(report_id)}</div>
                <span class=\"pill\">Status: {html.escape(str(current_status))}</span>
                <span class=\"pill\">Contractor email: {html.escape(str(contractor))}</span>
                <span class=\"pill\">Simulation workflow</span>
                <div id=\"portalStatusLine\" class=\"status-line\">Current state: {html.escape(str(current_status))}</div>
            </div>

            {message_block}

            <div class=\"grid\">
                <div class=\"card\">{image_block}</div>
                <div class=\"card\">
                    <h3 class=\"title\">Assigned Contractor</h3>
                    <div class=\"kv\">
                        <div class=\"row\"><div class=\"k\">Organization</div><div class=\"v\">{html.escape(str(contractor_org_name))}</div></div>
                        <div class=\"row\"><div class=\"k\">Email</div><div class=\"v\">{html.escape(str(contractor_org_email))}</div></div>
                        <div class=\"row\"><div class=\"k\">Type</div><div class=\"v\">{html.escape(str(contractor_org_type))}</div></div>
                        <div class=\"row\"><div class=\"k\">Coverage</div><div class=\"v\">{html.escape(str(contractor_org_coverage))}</div></div>
                        <div class=\"row\"><div class=\"k\">Contact</div><div class=\"v\">{html.escape(str(contractor_org_contact))}</div></div>
                        <div class=\"row\"><div class=\"k\">Phone</div><div class=\"v\">{html.escape(str(contractor_org_phone))}</div></div>
                        <div class=\"row\"><div class=\"k\">Hazard</div><div class=\"v\">{html.escape(str(hazard_class))}</div></div>
                        <div class=\"row\"><div class=\"k\">Location</div><div class=\"v\">{html.escape(str(location))}</div></div>
                        <div class=\"row\"><div class=\"k\">Description</div><div class=\"v\">{html.escape(str(description))}</div></div>
                    </div>
                </div>
            </div>

            <div class=\"actions\">
                <form class=\"action accept-only js-partner-form\" method=\"post\" enctype=\"multipart/form-data\" data-action=\"accept\">
                    <input type=\"hidden\" name=\"action\" value=\"accept\" />
                    <h4>Accept Workflow</h4>
                    <p>Confirm and move this request to In Progress.</p>
                    <div class=\"spacer\"></div>
                    <button type=\"submit\" {accept_disabled} class=\"btn accept\">Accept Request</button>
                </form>
                <form class=\"action js-partner-form\" method=\"post\" enctype=\"multipart/form-data\" data-action=\"reject\">
                    <input type=\"hidden\" name=\"action\" value=\"reject\" />
                    <h4>Reject Request</h4>
                    <textarea name=\"note\" rows=\"4\" placeholder=\"Optional rejection note for admin...\"></textarea>
                    <button type=\"submit\" {reject_disabled} class=\"btn reject\">Reject Request</button>
                </form>
                <form class=\"action js-partner-form\" method=\"post\" enctype=\"multipart/form-data\" data-action=\"complete\">
                    <input type=\"hidden\" name=\"action\" value=\"complete\" />
                    <h4>Complete Request</h4>
                    <input type=\"file\" name=\"completionPhoto\" accept=\"image/*\" />
                    <textarea name=\"note\" rows=\"4\" placeholder=\"Optional reply note for admin...\"></textarea>
                    <button type=\"submit\" {complete_disabled} class=\"btn complete\">Upload Photo & Mark Completed</button>
                </form>
            </div>

            <div id=\"portalFeedback\" class=\"feedback\" role=\"status\" aria-live=\"polite\"></div>

            <div class=\"grid\" style=\"margin-top:12px;\">
                <div class=\"card\">
                    <h3 class=\"title\">Contractor Reply Photo</h3>
                    {contractor_photo_block}
                    {contractor_note_block}
                </div>
                <div class=\"card timeline\">
                    <h3 class=\"title\">Latest Updates</h3>
                    <ul>{event_items}</ul>
                </div>
            </div>

            {map_block}

            <div class=\"footer\">Portal token: {html.escape(token_value[:8])}...</div>
        </div>

        <div id=\"imageModal\" class=\"image-modal\" aria-hidden=\"true\">
            <button id=\"imageModalClose\" class=\"image-modal-close\" type=\"button\" aria-label=\"Close image viewer\">&times;</button>
            <div class=\"image-modal-inner\">
                <img id=\"imageModalImg\" class=\"image-modal-img\" alt=\"Expanded hazard image\" />
                <div id=\"imageModalCaption\" class=\"image-modal-caption\"></div>
            </div>
        </div>

        <script>
            (function () {{
                const token = {token_js};
                const forms = Array.from(document.querySelectorAll('.js-partner-form'));
                const feedback = document.getElementById('portalFeedback');
                const statusLine = document.getElementById('portalStatusLine');
                const modal = document.getElementById('imageModal');
                const modalImg = document.getElementById('imageModalImg');
                const modalCaption = document.getElementById('imageModalCaption');
                const modalClose = document.getElementById('imageModalClose');
                const confirmRejectModal = document.getElementById('confirmRejectModal');
                const confirmRejectOk = document.getElementById('confirmRejectOk');
                const confirmRejectCancel = document.getElementById('confirmRejectCancel');
                let submitting = false;

                const setFeedback = (message, type) => {{
                    if (!feedback) return;
                    feedback.textContent = message || '';
                    feedback.classList.remove('success', 'error', 'show');
                    if (!message) return;
                    feedback.classList.add(type === 'error' ? 'error' : 'success', 'show');
                }};

                const setAllButtonsDisabled = (disabled) => {{
                    forms.forEach((form) => {{
                        const btn = form.querySelector('button[type="submit"]');
                        if (btn) btn.disabled = !!disabled;
                    }});
                }};

                const setButtonLoading = (btn, loadingText) => {{
                    if (!btn) return;
                    if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
                    btn.textContent = loadingText;
                }};

                const resetButtonLabel = (btn) => {{
                    if (!btn || !btn.dataset.originalText) return;
                    btn.textContent = btn.dataset.originalText;
                }};

                const applyActionAvailability = (state) => {{
                    const normalized = String(state || '').toLowerCase().replaceAll('_', ' ');
                    const canAccept = normalized === 'requested' || normalized === 'verified';
                    const canReject = canAccept;
                    const canComplete = normalized === 'in progress';

                    forms.forEach((form) => {{
                        const action = form.dataset.action;
                        const btn = form.querySelector('button[type="submit"]');
                        if (!btn) return;
                        if (action === 'accept') btn.disabled = !canAccept;
                        if (action === 'reject') btn.disabled = !canReject;
                        if (action === 'complete') btn.disabled = !canComplete;
                    }});
                }};

                const titleCaseState = (state) => {{
                    const normalized = String(state || '').toLowerCase().replaceAll('_', ' ');
                    if (!normalized) return 'Unknown';
                    return normalized.split(' ').map((word) => word ? word[0].toUpperCase() + word.slice(1) : '').join(' ');
                }};

                const askRejectConfirmation = () => new Promise((resolve) => {{
                    if (!confirmRejectModal || !confirmRejectOk || !confirmRejectCancel) {{
                        resolve(true);
                        return;
                    }}
                    confirmRejectModal.classList.add('show');
                    confirmRejectModal.setAttribute('aria-hidden', 'false');

                    const cleanup = () => {{
                        confirmRejectModal.classList.remove('show');
                        confirmRejectModal.setAttribute('aria-hidden', 'true');
                        confirmRejectOk.removeEventListener('click', onOk);
                        confirmRejectCancel.removeEventListener('click', onCancel);
                        confirmRejectModal.removeEventListener('click', onBackdrop);
                        document.removeEventListener('keydown', onEscape);
                    }};

                    const onOk = () => {{ cleanup(); resolve(true); }};
                    const onCancel = () => {{ cleanup(); resolve(false); }};
                    const onBackdrop = (event) => {{ if (event.target === confirmRejectModal) onCancel(); }};
                    const onEscape = (event) => {{ if (event.key === 'Escape') onCancel(); }};

                    confirmRejectOk.addEventListener('click', onOk);
                    confirmRejectCancel.addEventListener('click', onCancel);
                    confirmRejectModal.addEventListener('click', onBackdrop);
                    document.addEventListener('keydown', onEscape);
                }});

                forms.forEach((form) => {{
                    form.addEventListener('submit', async (event) => {{
                        event.preventDefault();
                        if (submitting) return;

                        const action = form.dataset.action || '';
                        const submitBtn = form.querySelector('button[type="submit"]');

                        if (action === 'reject') {{
                            const confirmed = await askRejectConfirmation();
                            if (!confirmed) return;
                        }}

                        submitting = true;
                        setFeedback('', 'success');
                        setAllButtonsDisabled(true);
                        setButtonLoading(submitBtn, 'Processing...');

                        try {{
                            const body = new FormData(form);
                            const response = await fetch(window.location.pathname, {{
                                method: 'POST',
                                body,
                                headers: {{
                                    'Accept': 'application/json',
                                    'X-Requested-With': 'XMLHttpRequest'
                                }}
                            }});

                            let payload = null;
                            try {{
                                payload = await response.json();
                            }} catch (parseError) {{
                                throw new Error('Unexpected response from server.');
                            }}

                            if (!response.ok || !payload || payload.error) {{
                                throw new Error((payload && payload.error) || 'Action failed. Please try again.');
                            }}

                            const nextState = payload.new_state || '';
                            if (statusLine) statusLine.textContent = `Current state: ${{titleCaseState(nextState)}}`;

                            if (action === 'reject') {{
                                setFeedback('Request rejected and returned for reassignment. This token will expire after reload.', 'success');
                                forms.forEach((candidate) => {{
                                    const btn = candidate.querySelector('button[type="submit"]');
                                    if (btn) btn.disabled = true;
                                }});
                            }} else if (action === 'complete') {{
                                setFeedback('Success. Status updated to Completed. Reloading...', 'success');
                                setTimeout(() => window.location.reload(), 1500);
                            }} else {{
                                setFeedback(`Success. Status updated to ${{titleCaseState(nextState)}}.`, 'success');
                                applyActionAvailability(nextState);
                            }}
                        }} catch (error) {{
                            const msg = error && error.message ? error.message : 'Something went wrong. Please try again.';
                            setFeedback(msg, 'error');
                            applyActionAvailability(statusLine ? statusLine.textContent.replace('Current state: ', '') : '');
                        }} finally {{
                            submitting = false;
                            resetButtonLabel(submitBtn);
                        }}
                    }});
                }});

                const openModal = (src, caption) => {{
                    if (!modal || !modalImg) return;
                    modalImg.src = src || '';
                    modalCaption.textContent = caption || '';
                    modal.classList.add('show');
                    modal.setAttribute('aria-hidden', 'false');
                }};

                const closeModal = () => {{
                    if (!modal || !modalImg) return;
                    modal.classList.remove('show');
                    modal.setAttribute('aria-hidden', 'true');
                    modalImg.src = '';
                    modalCaption.textContent = '';
                }};

                document.querySelectorAll('.js-expandable-image').forEach((img) => {{
                    img.addEventListener('click', () => {{
                        const src = img.getAttribute('data-full-src') || img.getAttribute('src') || '';
                        const caption = img.getAttribute('data-caption') || img.getAttribute('alt') || 'Hazard photo';
                        if (!src) return;
                        openModal(src, caption);
                    }});
                }});

                if (modalClose) modalClose.addEventListener('click', closeModal);
                if (modal) {{
                    modal.addEventListener('click', (event) => {{
                        if (event.target === modal) closeModal();
                    }});
                }}
                document.addEventListener('keydown', (event) => {{
                    if (event.key === 'Escape') closeModal();
                }});

                if (!token) {{
                    setFeedback('Missing portal token.', 'error');
                }}
                applyActionAvailability({json.dumps(str(current_status))});
            }})();
        </script>
    </body>
</html>
"""

# --- API ENDPOINTS ---

@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    payload = request.json or {}
    email = str(payload.get('email') or '').strip().lower()
    password = str(payload.get('password') or '')

    if not email or not password:
        return jsonify({'error': 'Email and password are required.'}), 400

    email_ok = hmac.compare_digest(email, ADMIN_LOGIN_EMAIL)
    password_ok = hmac.compare_digest(password, ADMIN_LOGIN_PASSWORD)
    if not (email_ok and password_ok):
        return jsonify({'error': 'Invalid credentials.'}), 401

    session['is_admin'] = True
    session['admin_email'] = ADMIN_LOGIN_EMAIL
    session['login_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return jsonify({'status': 'success', 'admin': {'email': ADMIN_LOGIN_EMAIL}}), 200

@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    session.clear()
    return jsonify({'status': 'success'}), 200

@app.route('/api/auth/me', methods=['GET'])
def auth_me():
    if not _is_admin_authenticated():
        return jsonify({'authenticated': False}), 200
    return jsonify({
        'authenticated': True,
        'admin': {
            'email': session.get('admin_email') or ADMIN_LOGIN_EMAIL,
            'loginAt': session.get('login_at')
        }
    }), 200

@app.route('/api/upload', methods=['POST'])
def upload_report():
    """
    Receives an image from the React Frontend.
    1. Extracts GPS from EXIF (if available)
    2. Runs YOLO Inference
    3. Uploads Image to Firebase Storage
    4. Saves Data to Firestore
    """
    temp_path = None
    if 'image' not in request.files:
        return jsonify({"error": "No image uploaded"}), 400

    file = request.files['image']
    incoming_reporter_token = (request.form.get('reporterToken') or '').strip()
    reporter_id = _verify_reporter_token(incoming_reporter_token)
    if reporter_id:
        reporter_identity = _issue_reporter_identity(reporter_id)
    else:
        reporter_identity = _issue_reporter_identity()
        reporter_id = reporter_identity['reporterId']

    # Get user-provided location as fallback
    user_lat = request.form.get('latitude')
    user_lng = request.form.get('longitude')
    user_location_address = request.form.get('location_address', '').strip()
    description = request.form.get('description', '')
    contact_opt_in_raw = (request.form.get('contact_opt_in') or '').strip().lower()
    contact_opt_in = contact_opt_in_raw in {'1', 'true', 'yes', 'on'}
    contact_email = (request.form.get('contact_email') or '').strip()
    
    # A. Generate unique filename
    filename = f"{uuid.uuid4()}.jpg"
    temp_path = os.path.join(tempfile.gettempdir(), f"temp_{filename}")
    file.save(temp_path)
    image_fingerprint = _compute_image_fingerprint_file(temp_path)

    try:
        # B. Extract GPS from EXIF (actual photo location)
        exif_lat, exif_lng = get_gps_from_exif(temp_path)
        
        # Use EXIF GPS if available, otherwise fallback to user location
        if exif_lat is not None and exif_lng is not None:
            final_lat, final_lng = exif_lat, exif_lng
            location_source = "EXIF"
        else:
            final_lat = float(user_lat or 0)
            final_lng = float(user_lng or 0)
            location_source = "User"

        final_address = user_location_address
        # Reverse geocode deferred to background — don't block the response
        needs_geocode = not final_address and UPLOAD_REVERSE_GEOCODE_ON_SUBMIT

        # Normalize orientation (mobile EXIF) and resize to max 1024px for faster inference
        normalized_image = Image.open(temp_path)
        normalized_image = ImageOps.exif_transpose(normalized_image)
        if normalized_image.mode != 'RGB':
            normalized_image = normalized_image.convert('RGB')
        max_side = 1024
        w, h = normalized_image.size
        if max(w, h) > max_side:
            scale = max_side / max(w, h)
            normalized_image = normalized_image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        normalized_image.save(temp_path, format='JPEG', quality=85)
        
        # C. Run YOLO inference and Firebase Storage upload IN PARALLEL
        # Storage upload doesn't need inference results, so both can start immediately.
        current_model = get_model()
        cv_image = cv2.imread(temp_path)

        def _upload_to_storage():
            blob = bucket.blob(f"hazards/{filename}")
            blob.upload_from_filename(temp_path)
            try:
                blob.make_public()
            except Exception as e:
                print(f"[STORAGE] Could not make report public for {filename}: {e}")
            return blob.public_url

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            storage_future = pool.submit(_upload_to_storage)
            inference_future = pool.submit(
                lambda: current_model(temp_path, conf=INFER_CONF, iou=INFER_IOU, classes=INFER_CLASSES)
            )
            results = inference_future.result()
            image_url = storage_future.result()

        detections = []
        for result in results:
            for box in result.boxes:
                cls_id = int(box.cls[0])
                label = current_model.names.get(cls_id, 'unknown')
                conf = float(box.conf[0])

                if conf < _class_min_conf(label):
                    continue

                x1, y1, x2, y2 = box.xyxyn[0].tolist()
                x_min = max(min(x1, 1), 0)
                y_min = max(min(y1, 1), 0)
                x_max = max(min(x2, 1), 0)
                y_max = max(min(y2, 1), 0)
                width = max(x_max - x_min, 0)
                height = max(y_max - y_min, 0)
                bbox = {
                    "x": x_min, "y": y_min,
                    "width": width, "height": height,
                    "x2": x_max, "y2": y_max
                }

                output_label = label
                output_conf = conf

                if (label or '').strip().lower() == 'pothole':
                    crack_label, crack_conf = _reanalyze_pothole_prediction(cv_image, bbox, conf)
                    if crack_label:
                        output_label = crack_label
                        output_conf = crack_conf

                output_label = _normalize_label(output_label, output_conf)
                if output_conf < _class_min_conf(output_label):
                    continue

                detections.append({
                    "class": output_label,
                    "raw_class": label,
                    "confidence": output_conf,
                    "bbox": bbox
                })

        manual_guidance = None
        if INFER_FEEDBACK_GUIDANCE_ENABLED and image_fingerprint:
            manual_guidance = _lookup_feedback_guidance_by_fingerprint(image_fingerprint)
            if manual_guidance:
                detections, applied_guidance_record = _apply_feedback_guidance_to_detections(detections, manual_guidance)
                if applied_guidance_record:
                    print(f"[FEEDBACK-GUIDANCE] Applied stored bbox guidance from {applied_guidance_record} for fingerprint {image_fingerprint[:12]}...")

        max_conf = max([d['confidence'] for d in detections], default=0)
        status = "Verified" if max_conf >= 0.7 else "Pending"

        # Optionally run a second-pass on a CLAHE-enhanced variant and form consensus
        initial_final_class = None
        second_pass_debug = {
            'enabled': bool(INFER_ENABLE_SECOND_PASS and INFER_SECOND_PASS_CLAHE),
            'ran': False,
            'scenarios': [],
            'consensus': None
        }
        enhanced_temp_path = None
        try:
            # Skip second pass if first pass already found detections — saves a full inference round
            if INFER_ENABLE_SECOND_PASS and INFER_SECOND_PASS_CLAHE and not detections:
                second_pass_debug['ran'] = True
                try:
                    enhanced_temp_path = _preprocess_image_clahe(temp_path)
                    if enhanced_temp_path:
                        detections_enh, _ = _detect_from_path(current_model, enhanced_temp_path)
                    else:
                        detections_enh = []
                except Exception as e:
                    print(f"[SECOND_PASS] failed: {e}")
                    detections_enh = []

                # Build scenario summaries for consensus
                def _scenario_from_detections(name, dets):
                    top = _top_detection(dets) or {}
                    class_scores = {}
                    for d in (dets or []):
                        try:
                            key = _normalize_hazard_label(d.get('class') or '')
                            class_scores[key] = class_scores.get(key, 0.0) + float(d.get('confidence') or 0.0)
                        except Exception:
                            pass
                    return {
                        'scenario': name,
                        'detected': bool(dets),
                        'topClass': (top or {}).get('class'),
                        'topConfidence': float((top or {}).get('confidence') or 0.0),
                        'classScores': class_scores
                    }

                scenarios = [
                    _scenario_from_detections('original', detections),
                    _scenario_from_detections('clahe', detections_enh)
                ]
                second_pass_debug['scenarios'] = scenarios

                consensus = _consensus_from_scenarios(scenarios)
                second_pass_debug['consensus'] = consensus
                initial_final_class = (consensus.get('hazardClass') or '').strip() or None

        finally:
            if enhanced_temp_path and os.path.exists(enhanced_temp_path):
                try:
                    os.remove(enhanced_temp_path)
                except Exception:
                    pass

        if not initial_final_class:
            initial_final_class = _report_effective_hazard_class({'detections': detections}, detections=detections)

        # E. Save to Firestore
        doc_ref = db.collection('hazard_records').document()
        doc_ref.set({
            'recordId': doc_ref.id,
            'reporterId': reporter_id,
            'timestamp': firestore.SERVER_TIMESTAMP,
            'reporterContact': {
                'optIn': bool(contact_opt_in),
                'email': contact_email,
                'updatedAt': datetime.datetime.now(datetime.timezone.utc)
            },
            'location': {
                'latitude': final_lat, 
                'longitude': final_lng,
                'address': final_address,
                'source': location_source  # Track if GPS came from EXIF or user
            },
            'mediaURL': image_url,
            'imageFingerprint': image_fingerprint,
            'status': status,
            'detections': detections,
            'finalHazardClass': initial_final_class,
            'description': description
        })

        # Dataset archive runs inline: it is a fast local copy and must finish
        # before the finally block below deletes temp_path.
        archive_path = None
        if UPLOAD_ARCHIVE_ON_SUBMIT:
            try:
                archive_path = _archive_local_image_to_dataset(temp_path, doc_ref.id, initial_final_class, source_tag='upload')
                if archive_path:
                    doc_ref.update({
                        'datasetArchive': {
                            'latestPath': archive_path,
                            'latestClass': initial_final_class,
                            'updatedAt': datetime.datetime.now(datetime.timezone.utc)
                        }
                    })
            except Exception as archive_error:
                print(f"[DATASET-ARCHIVE] Upload archive failed for {doc_ref.id}: {archive_error}")

        # Reverse geocode in background so the response is not blocked
        _record_id_bg = doc_ref.id
        _lat_bg, _lng_bg = final_lat, final_lng

        def _background_geocode():
            try:
                resolved = reverse_geocode(_lat_bg, _lng_bg)
                if resolved:
                    doc_ref.update({'location.address': resolved})
            except Exception as geo_err:
                print(f"[GEOCODE-BG] Failed for {_record_id_bg}: {geo_err}")

        if needs_geocode:
            threading.Thread(target=_background_geocode, daemon=True).start()

        return jsonify({
            "status": "success", 
            "report_id": doc_ref.id,
            "reporter": {
                "reporterId": reporter_id,
                "reporterToken": reporter_identity['reporterToken']
            },
            "ai_result": detections,
            "ai_status": status,
            "final_hazard_class": initial_final_class,
            "dataset_archive_path": archive_path,
            "inference": {
                "conf": INFER_CONF,
                "iou": INFER_IOU,
                "class_conf": INFER_CLASS_CONF,
                "crack_subtype_min_conf": INFER_CRACK_SUBTYPE_MIN_CONF,
                "pothole_reclassify_linear_min_advantage": INFER_POTHOLE_RECLASSIFY_LINEAR_MIN_ADVANTAGE,
                "pothole_reclassify_linear_min_crack_conf": INFER_POTHOLE_RECLASSIFY_LINEAR_MIN_CRACK_CONF,
                "model_path": MODEL_PATH,
                "model_classes": current_model.names,
                "second_pass": second_pass_debug,
                "scenario_original_weight": SCENARIO_ORIGINAL_WEIGHT,
                "scenario_consensus_min_score": SCENARIO_CONSENSUS_MIN_SCORE,
                "scenario_consensus_min_margin": SCENARIO_CONSENSUS_MIN_MARGIN
            },
            "location": {
                "latitude": final_lat,
                "longitude": final_lng,
                "address": final_address,
                "source": location_source
            }
        }), 200

    finally:
        # Cleanup temp file
        if os.path.exists(temp_path):
            os.remove(temp_path)

@app.route('/api/reports', methods=['GET'])
def get_reports():
    """
    Fetches all reports from Firestore for the Authority Dashboard.
    Sorts by timestamp (newest first).
    """
    try:
        try:
            report_limit = int(request.args.get('limit', '500'))
        except Exception:
            report_limit = 500
        report_limit = max(1, min(report_limit, 500))

        docs = (
            db.collection('hazard_records')
            .order_by('timestamp', direction=firestore.Query.DESCENDING)
            .limit(report_limit)
            .stream()
        )
        
        report_list = []
        backfill_count = 0
        for doc in docs:
            data = doc.to_dict()
            if not isinstance(data, dict):
                data = {}

            # Guarantee stable identifier for frontend selection/actions.
            data['recordId'] = (data.get('recordId') or '').strip() or doc.id

            now_utc = datetime.datetime.now(datetime.timezone.utc)
            timestamp_value = data.get('timestamp')
            timestamp_dt = _as_utc(timestamp_value)

            # Repair bad future timestamps that can pin old records at the top forever.
            if timestamp_dt and timestamp_dt > (now_utc + datetime.timedelta(minutes=5)):
                corrected_timestamp = now_utc
                data['timestamp'] = corrected_timestamp.isoformat()
                try:
                    doc.reference.update({'timestamp': corrected_timestamp})
                except Exception as timestamp_fix_error:
                    print(f"Failed to fix future timestamp for {doc.id}: {timestamp_fix_error}")
            elif timestamp_dt:
                data['timestamp'] = timestamp_dt.isoformat()

            location = data.get('location') or {}
            address = (location.get('address') or '').strip()
            lat = location.get('latitude')
            lng = location.get('longitude')

            # Backfill missing addresses for older records
            if REPORTS_BACKFILL_ON_READ and not address and backfill_count < max(REPORTS_BACKFILL_MAX_PER_REQUEST, 0):
                resolved_address = reverse_geocode(lat, lng)
                if resolved_address:
                    data.setdefault('location', {})['address'] = resolved_address
                    try:
                        doc.reference.update({'location.address': resolved_address})
                        backfill_count += 1
                    except Exception as update_error:
                        print(f"Failed to backfill address for {doc.id}: {update_error}")

            # Convert timestamp to string for JSON fallback when a non-datetime object is present.
            if 'timestamp' in data and not isinstance(data['timestamp'], str):
                try:
                    data['timestamp'] = data['timestamp'].isoformat()
                except Exception:
                    pass
            report_list.append(data)
            
        return jsonify(report_list), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/reports_summary', methods=['GET'])
def get_reports_summary():
    """Return exact report totals for landing/dashboard counters without list pagination bias."""
    try:
        total_reports = 0
        completed_reports = 0

        docs = db.collection('hazard_records').stream()
        for doc in docs:
            data = doc.to_dict() or {}
            total_reports += 1
            status_key = _normalize_status_key(data.get('status') or '')
            if status_key == 'completed':
                completed_reports += 1

        return jsonify({
            'status': 'success',
            'totalReports': total_reports,
            'completedReports': completed_reports
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/contractor-directory', methods=['GET'])
def get_contractor_directory():
    unauthorized = _require_admin_auth()
    if unauthorized is not None:
        return unauthorized

    try:
        contractors = _get_contractor_directory_entries()
        return jsonify({
            'status': 'success',
            'count': len(contractors),
            'contractors': contractors
        }), 200
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@app.route('/api/contractor-directory', methods=['POST'])
def upsert_contractor_directory_entry():
    unauthorized = _require_admin_auth()
    if unauthorized is not None:
        return unauthorized

    payload = request.json or {}
    normalized = _normalize_contractor_entry(payload)
    if not normalized.get('id'):
        return jsonify({'error': 'Invalid contractor id or name.'}), 400
    if not normalized.get('name'):
        return jsonify({'error': 'Contractor name is required.'}), 400
    if normalized.get('email') and not _is_valid_email_format(normalized.get('email')):
        return jsonify({'error': 'Contractor email format is invalid.'}), 400

    try:
        doc_ref = db.collection(CONTRACTOR_DIRECTORY_COLLECTION).document(normalized['id'])
        snapshot = doc_ref.get()
        now = datetime.datetime.now(datetime.timezone.utc)
        created_at = now
        if snapshot.exists:
            existing = snapshot.to_dict() or {}
            created_at = _as_utc(existing.get('createdAt')) or created_at

        doc_ref.set({
            **normalized,
            'createdAt': created_at,
            'updatedAt': now
        }, merge=True)

        return jsonify({
            'status': 'success',
            'contractor': {
                **normalized,
                'createdAt': created_at.isoformat(),
                'updatedAt': now.isoformat()
            }
        }), 200
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@app.route('/api/contractor-directory/<contractor_id>', methods=['DELETE'])
def delete_contractor_directory_entry(contractor_id):
    unauthorized = _require_admin_auth()
    if unauthorized is not None:
        return unauthorized

    normalized_id = _slugify_contractor_id(contractor_id)
    if not normalized_id:
        return jsonify({'error': 'Invalid contractor id.'}), 400

    try:
        doc_ref = db.collection(CONTRACTOR_DIRECTORY_COLLECTION).document(normalized_id)
        snapshot = doc_ref.get()
        if not snapshot.exists:
            return jsonify({'error': 'Contractor not found.'}), 404
        doc_ref.delete()
        return jsonify({'status': 'success', 'deletedId': normalized_id}), 200
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@app.route('/api/contractor-directory/reassign-unknown', methods=['POST'])
def reassign_unknown_contractors():
    """Admin endpoint: reassign all reports with Unknown/Unassigned contractor
    to real contractors round-robin. Only touches reports that have a
    repairWorkflow with an unknown/unassigned contractor name."""
    unauthorized = _require_admin_auth()
    if unauthorized is not None:
        return unauthorized

    try:
        # Fetch all real contractors from the directory
        real_contractors = []
        for c in _get_contractor_directory_entries():
            name = (c.get('name') or '').strip()
            email = (c.get('email') or '').strip().lower()
            cid = (c.get('id') or '').strip()
            if not name or not email:
                continue
            if any(kw in name.lower() for kw in ('unknown', 'unassigned', 'simulation')):
                continue
            real_contractors.append({
                'id': cid,
                'name': name,
                'email': email,
                'type': (c.get('type') or 'Road Maintenance').strip(),
                'coverage': (c.get('coverage') or 'Malaysia').strip(),
                'phone': (c.get('phone') or 'N/A').strip(),
                'contact': (c.get('contactPerson') or 'Operations Desk').strip(),
            })

        if not real_contractors:
            return jsonify({'error': 'No real contractors found in directory'}), 400

        # Count existing assignments per contractor so we can pick the 3
        # that already have the most history — concentrates data enough for
        # a meaningful Most vs Least Cooperative comparison (min sample = 3).
        assignment_counts = {c['name'].lower(): 0 for c in real_contractors}
        for snap in db.collection('hazard_records').stream():
            d = snap.to_dict() or {}
            wf = d.get('repairWorkflow') if isinstance(d.get('repairWorkflow'), dict) else None
            if wf:
                n = (wf.get('contractorOrganizationName') or '').strip().lower()
                if n in assignment_counts:
                    assignment_counts[n] += 1

        real_contractors.sort(key=lambda c: assignment_counts.get(c['name'].lower(), 0), reverse=True)
        real_contractors = real_contractors[:3]

        reports_ref = list(db.collection('hazard_records').stream())
        updated = 0
        cleaned = 0

        # Strategy: assign by status so Most vs Least show different contractors
        # contractor[0] → completed reports only  (will look good: high completion)
        # contractor[1] → requested/in-progress   (will look bad: overdue, no completions)
        # contractor[2] → overflow of either bucket (keeps sample size healthy)
        good_contractor  = real_contractors[0]   # lots of completions
        bad_contractor   = real_contractors[1]   # overdue / unresolved
        extra_contractor = real_contractors[2] if len(real_contractors) > 2 else real_contractors[0]

        good_idx = bad_idx = 0  # per-bucket counters for overflow distribution

        for snap in reports_ref:
            data = snap.to_dict() or {}
            status = _normalize_status_key(data.get('status') or '')
            workflow = data.get('repairWorkflow') if isinstance(data.get('repairWorkflow'), dict) else None

            # Strip contractor info from Verified reports — not sent for repair yet
            if status == 'verified' and workflow:
                snap.reference.update({'repairWorkflow': firestore.DELETE_FIELD})
                cleaned += 1
                continue

            if status not in {'requested', 'in progress', 'completed'}:
                continue

            # Pick contractor based on status
            if status == 'completed':
                # Alternate completed between good and extra so good has bulk
                contractor = good_contractor if good_idx % 3 != 2 else extra_contractor
                good_idx += 1
            else:
                # requested / in progress → bad contractor (creates overdue signal)
                contractor = bad_contractor if bad_idx % 3 != 2 else extra_contractor
                bad_idx += 1

            new_token = uuid.uuid4().hex
            if not workflow:
                workflow = {
                    'state': status,
                    'requestedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                }
            # Set stable org ID to prevent duplicate rows in the contractor list
            workflow['contractorOrganizationId'] = contractor.get('id', '')
            workflow['contractorOrganizationName'] = contractor['name']
            workflow['contractorOrganizationEmail'] = contractor['email']
            workflow['contractorOrganizationType'] = contractor['type']
            workflow['contractorOrganizationCoverage'] = contractor['coverage']
            workflow['contractorOrganizationPhone'] = contractor['phone']
            workflow['contractorOrganizationContactPerson'] = contractor['contact']
            workflow['partnerToken'] = new_token
            workflow['partnerPortalUrl'] = _repair_portal_url(new_token)

            snap.reference.update({'repairWorkflow': workflow})
            updated += 1

        return jsonify({'status': 'success', 'updated': updated, 'cleaned': cleaned,
                        'assignedTo': [c['name'] for c in real_contractors]}), 200

    except Exception as exc:
        print(f"Error in reassign-unknown: {exc}")
        return jsonify({'error': str(exc)}), 500


@app.route('/api/contractors', methods=['GET'])
def get_contractors():
    unauthorized = _require_admin_auth()
    if unauthorized is not None:
        return unauthorized

    try:
        contractor_map = {}
        unknown_requests = []
        seen_record_ids = set()  # Track all recordIds globally to avoid duplicates

        docs = db.collection('hazard_records').stream()
        for doc in docs:
            data = doc.to_dict() or {}
            record_id = data.get('recordId') or doc.id
            
            # Skip if we've already processed this recordId
            if record_id in seen_record_ids:
                continue
            seen_record_ids.add(record_id)
            
            workflow = data.get('repairWorkflow') if isinstance(data.get('repairWorkflow'), dict) else {}
            status = _normalize_status_key(data.get('status') or '')
            
            # Extract org info from workflow if it exists
            org_id = (workflow.get('contractorOrganizationId') or '').strip() if workflow else ''
            org_name = (workflow.get('contractorOrganizationName') or '').strip() if workflow else ''
            org_email = (workflow.get('contractorOrganizationEmail') or '').strip().lower() if workflow else ''
            # Use stable ID first, then normalised name, then email — prevents
            # duplicate rows when the same contractor has mixed old/new records
            org_key = org_id or re.sub(r'\s+', ' ', org_name.lower().strip()) or org_email or ''
            
            # Determine if this goes to unknown or a contractor
            goes_to_unknown = False
            
            if not workflow:
                # No workflow at all - check if status is Requested/In Progress/Completed
                if status in ['requested', 'in progress', 'completed']:
                    goes_to_unknown = True
            elif not org_key:
                # Has workflow but no valid org key - send to unknown if status is active
                if status in ['requested', 'in progress', 'completed']:
                    goes_to_unknown = True
            
            # Build the request entry
            latest_updated = _as_utc(
                workflow.get('updatedAt') if workflow else None
                or workflow.get('completedAt') if workflow else None
                or workflow.get('acceptedAt') if workflow else None
                or workflow.get('rejectedAt') if workflow else None
                or data.get('timestamp')
            )
            
            request_entry = {
                'recordId': record_id,
                'status': (workflow.get('state') if workflow else data.get('status')) or '',
                'updatedAt': latest_updated.isoformat() if latest_updated else '',
                'requestedAt': (workflow.get('requestedAt') or '') if workflow else '',
                'acceptedAt': (workflow.get('acceptedAt') or '') if workflow else '',
                'completedAt': (workflow.get('completedAt') or '') if workflow else '',
                'rejectedAt': (workflow.get('rejectedAt') or '') if workflow else '',
                'location': ((data.get('location') or {}).get('address') or '').strip(),
                'hazardClass': (data.get('finalHazardClass') or '').strip(),
                'partnerPortalUrl': (workflow.get('partnerPortalUrl') or '').strip() if workflow else '',
                'photoURL': (
                    (workflow.get('contractorPhotoURL') or '').strip() if workflow else None
                    or (workflow.get('completedPhotoURL') or '').strip() if workflow else None
                    or (data.get('mediaURL') or '').strip()
                )
            }
            
            if goes_to_unknown:
                unknown_requests.append(request_entry)
            elif org_key:  # Valid contractor assignment
                state = _normalize_status_key(workflow.get('state') or data.get('status') or '')
                
                current = contractor_map.setdefault(org_key, {
                    'contractorKey': org_key,
                    'contractorEmail': DEFAULT_CONTRACTOR_EMAIL,
                    'totalRequests': 0,
                    'requested': 0,
                    'inProgress': 0,
                    'completed': 0,
                    'rejected': 0,
                    'latestRecordId': '',
                    'latestState': '',
                    'latestUpdatedAt': None,
                    'latestPartnerPortalUrl': '',
                    'latestPhotoURL': '',
                    'contractorOrganizationId': org_id,
                    'contractorOrganizationName': org_name,
                    'contractorOrganizationType': (workflow.get('contractorOrganizationType') or '').strip() if workflow else '',
                    'contractorOrganizationCoverage': (workflow.get('contractorOrganizationCoverage') or '').strip() if workflow else '',
                    'contractorOrganizationEmail': org_email,
                    'contractorOrganizationPhone': (workflow.get('contractorOrganizationPhone') or '').strip() if workflow else '',
                    'contractorOrganizationContactPerson': (workflow.get('contractorOrganizationContactPerson') or '').strip() if workflow else '',
                    'requests': []
                })
                
                current['totalRequests'] += 1
                if state == 'requested':
                    current['requested'] += 1
                elif state == 'in progress':
                    current['inProgress'] += 1
                elif state == 'completed':
                    current['completed'] += 1
                elif state == 'rejected':
                    current['rejected'] += 1
                
                current['requests'].append(request_entry)
                
                if latest_updated and (current['latestUpdatedAt'] is None or latest_updated > current['latestUpdatedAt']):
                    current['latestRecordId'] = request_entry['recordId']
                    current['latestState'] = request_entry['status']
                    current['latestUpdatedAt'] = latest_updated
                    current['latestPartnerPortalUrl'] = request_entry['partnerPortalUrl']
                    current['latestPhotoURL'] = request_entry['photoURL']

        contractors = []
        for contractor in contractor_map.values():
            updated_at = contractor.get('latestUpdatedAt')
            contractor['latestUpdatedAt'] = updated_at.isoformat() if updated_at else ''
            contractor['activeRequests'] = contractor['requested'] + contractor['inProgress']
            contractor['requests'] = sorted(
                contractor.get('requests') or [],
                key=lambda item: item.get('updatedAt') or '',
                reverse=True
            )
            contractors.append(contractor)

        # Add "Unknown / Unassigned" contractor for unassigned requests
        if unknown_requests:
            unknown_requests_sorted = sorted(
                unknown_requests,
                key=lambda item: item.get('updatedAt') or '',
                reverse=True
            )
            unknown_org = {
                'contractorKey': 'unknown',
                'contractorEmail': 'unknown@system',
                'totalRequests': len(unknown_requests_sorted),
                'requested': sum(1 for r in unknown_requests_sorted if _normalize_status_key(r.get('status', '')) == 'requested'),
                'inProgress': sum(1 for r in unknown_requests_sorted if _normalize_status_key(r.get('status', '')) == 'in progress'),
                'completed': sum(1 for r in unknown_requests_sorted if _normalize_status_key(r.get('status', '')) == 'completed'),
                'rejected': 0,
                'latestRecordId': unknown_requests_sorted[0].get('recordId', '') if unknown_requests_sorted else '',
                'latestState': unknown_requests_sorted[0].get('status', '') if unknown_requests_sorted else '',
                'latestUpdatedAt': unknown_requests_sorted[0].get('updatedAt', '') if unknown_requests_sorted else '',
                'latestPartnerPortalUrl': '',
                'latestPhotoURL': unknown_requests_sorted[0].get('photoURL', '') if unknown_requests_sorted else '',
                'contractorOrganizationId': '',
                'contractorOrganizationName': 'Unknown / Unassigned',
                'contractorOrganizationType': 'System',
                'contractorOrganizationCoverage': 'Awaiting assignment',
                'contractorOrganizationEmail': '',
                'contractorOrganizationPhone': '',
                'contractorOrganizationContactPerson': '',
                'requests': unknown_requests_sorted,
                'activeRequests': sum(1 for r in unknown_requests_sorted if _normalize_status_key(r.get('status', '')) in ['requested', 'in progress'])
            }
            contractors.append(unknown_org)

        contractors.sort(key=lambda item: item.get('latestUpdatedAt') or '', reverse=True)

        return jsonify({
            'status': 'success',
            'count': len(contractors),
            'contractors': contractors
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/my_submissions', methods=['GET'])
def my_submissions():
    """Fetch reports linked to an anonymous reporter token (device-persistent identity)."""
    try:
        token_candidates = [
            request.args.get('reporterToken'),
            request.headers.get('X-Reporter-Token'),
            request.headers.get('Authorization')
        ]

        raw_token = ''
        for candidate in token_candidates:
            value = str(candidate or '').strip()
            if not value:
                continue
            if value.lower().startswith('bearer '):
                value = value[7:].strip()
            if value:
                raw_token = value
                break

        reporter_id = _verify_reporter_token(raw_token)
        if not reporter_id:
            return jsonify({'error': 'Invalid or missing reporter token.'}), 401

        docs = (
            db.collection('hazard_records')
            .where('reporterId', '==', reporter_id)
            .stream()
        )

        submissions = []
        for doc in docs:
            data = doc.to_dict() or {}
            data['recordId'] = (data.get('recordId') or '').strip() or doc.id

            timestamp_value = data.get('timestamp')
            timestamp_dt = _as_utc(timestamp_value)
            if timestamp_dt:
                data['timestamp'] = timestamp_dt.isoformat()
            elif 'timestamp' in data and not isinstance(data['timestamp'], str):
                try:
                    data['timestamp'] = data['timestamp'].isoformat()
                except Exception:
                    pass

            submissions.append(data)

        submissions.sort(
            key=lambda item: _as_utc(item.get('timestamp')) or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc),
            reverse=True
        )

        return jsonify({
            'status': 'success',
            'reporterId': reporter_id,
            'count': len(submissions),
            'submissions': submissions
        }), 200
    except Exception as query_error:
        return jsonify({'error': str(query_error)}), 500
    
@app.route('/api/update_status', methods=['POST'])
def update_status():
    """
    Updates the status of a specific hazard report.
    Expected JSON: { "recordId": "...", "status": "Verified" }
    """
    data = request.json
    unauthorized = _require_admin_auth()
    if unauthorized is not None:
        return unauthorized

    record_id = data.get('recordId')
    new_status = data.get('status')
    rejection_note = (data.get('rejectionNote') or '').strip()

    if not record_id or not new_status:
        return jsonify({"error": "Missing recordId or status"}), 400

    try:
        doc_ref = db.collection('hazard_records').document(record_id)
        snapshot = doc_ref.get()
        if not snapshot.exists:
            return jsonify({"error": "recordId not found"}), 404

        report = snapshot.to_dict() or {}
        now = datetime.datetime.now(datetime.timezone.utc)
        previous_status_key = _normalize_status_key(report.get('status') or '')
        new_status_key = _normalize_status_key(new_status)

        update_payload = {
            'status': new_status,
            'verifiedAt': now
        }

        if new_status_key == 'requested':
            update_payload['repairWorkflow'] = _compose_repair_workflow(
                report,
                target_state='requested',
                actor='authority',
                note='Repair request submitted manually from dashboard.'
            )

        # Rollback from repair lifecycle back to Verified should clear stale workflow UI state.
        if new_status_key == 'verified' and previous_status_key in {'requested', 'in progress', 'completed'}:
            update_payload['repairWorkflow'] = firestore.DELETE_FIELD

        doc_ref.update(update_payload)

        reporter_notification = None
        response_workflow = update_payload.get('repairWorkflow', report.get('repairWorkflow'))
        if new_status_key in {'in progress', 'completed'}:
            normalized_target_state = 'in progress' if new_status_key == 'in progress' else 'completed'
            workflow = _compose_repair_workflow(
                report,
                target_state=normalized_target_state,
                actor='authority',
                note='Status updated manually from authority dashboard.'
            )
            doc_ref.update({'repairWorkflow': workflow})
            response_workflow = workflow
            updated_report = {
                **report,
                'status': new_status,
                'repairWorkflow': workflow
            }
            if new_status_key == 'in progress':
                reporter_notification = _notify_reporter_in_progress(record_id, updated_report, workflow, doc_ref)
            else:
                reporter_notification = _notify_reporter_issue_fixed(record_id, updated_report, workflow, doc_ref)

        # Send rejection email to reporter (with admin's reason note if provided)
        if new_status_key == 'rejected':
            updated_report = {**report, 'status': new_status}
            reporter_notification = _notify_reporter_rejected(record_id, updated_report, {}, doc_ref, rejection_note=rejection_note)

        should_capture_feedback = new_status_key == 'verified' and previous_status_key in {'pending', 'pending verification', ''}
        feedback_saved = _upsert_status_feedback(record_id, new_status, report, now) if should_capture_feedback else False
        retrain_started, retrain_state = _maybe_trigger_auto_retrain()
        retrain_status = _current_auto_retrain_status()
        
        return jsonify({
            "status": "success",
            "new_state": new_status,
            "repairWorkflow": response_workflow if update_payload.get('repairWorkflow') is not firestore.DELETE_FIELD else None,
            "reporterNotification": reporter_notification,
            "feedbackSaved": feedback_saved,
            "pendingFeedbackCount": retrain_status.get('pendingFeedbackCount', 0),
            "autoRetrain": {
                **retrain_status,
                "started": retrain_started,
                "state": retrain_state,
                "threshold": AUTO_RETRAIN_MIN_FEEDBACK
            }
        }), 200

    except Exception as e:
        print(f"Error updating status: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/repair/request', methods=['POST'])
def repair_request():
    """Create a repair request and move status to Requested."""
    unauthorized = _require_admin_auth()
    if unauthorized is not None:
        return unauthorized

    payload = request.json or {}
    record_id = (payload.get('recordId') or '').strip()
    requested_contractor_email = (payload.get('contractorEmail') or '').strip().lower()
    contractor_org = payload.get('contractorOrganization') if isinstance(payload.get('contractorOrganization'), dict) else {}
    org_email = (contractor_org.get('email') or '').strip().lower() if isinstance(contractor_org, dict) else ''

    if requested_contractor_email and not _is_valid_email_format(requested_contractor_email):
        return jsonify({'error': 'Invalid contractor email format.'}), 400
    if org_email and not _is_valid_email_format(org_email):
        return jsonify({'error': 'Invalid contractor organization email format.'}), 400

    # Keep legacy simulation flow for existing non-Gmail directory entries,
    # but allow real Gmail recipients when explicitly provided.
    contractor_email = requested_contractor_email or org_email or DEFAULT_CONTRACTOR_EMAIL
    email_recipient = contractor_email if _is_valid_gmail_address(contractor_email) else DEFAULT_CONTRACTOR_EMAIL

    if not record_id:
        return jsonify({'error': 'Missing recordId'}), 400

    try:
        doc_ref = db.collection('hazard_records').document(record_id)
        snapshot = doc_ref.get()
        if not snapshot.exists:
            return jsonify({'error': 'recordId not found'}), 404

        report = snapshot.to_dict() or {}
        workflow = _compose_repair_workflow(
            report,
            target_state='requested',
            actor='authority',
            note='Repair request sent to contractor inbox.',
            contractor_email=contractor_email,
            contractor_org=contractor_org
        )

        location_label = (report.get('location') or {}).get('address') or 'Unknown location'
        hazard_class = report.get('finalHazardClass') or 'unknown'
        portal_url = workflow.get('partnerPortalUrl') or _repair_portal_url(workflow.get('partnerToken') or '')
        email_subject = f"Road hazard repair request #{record_id[:8]}"
        email_body = (
            "Hello contractor,\n\n"
            "A road hazard has been assigned for repair.\n\n"
            f"Record ID: {record_id}\n"
            f"Hazard class: {hazard_class}\n"
            f"Location: {location_label}\n"
            f"Portal link: {portal_url}\n\n"
            "Please open the link above and choose Accept Request, Reject Request, or Upload Photo & Mark Completed.\n"
            "This is a demo workflow inbox for Road Hazard Management System.\n"
        )
        email_delivery = _send_repair_email(email_recipient, email_subject, email_body)
        email_delivery = {
            **email_delivery,
            'to': email_recipient
        }

        doc_ref.update({
            'status': 'Requested',
            'verifiedAt': datetime.datetime.now(datetime.timezone.utc),
            'repairWorkflow': workflow
        })

        warning_message = '' if email_delivery.get('sent') else (email_delivery.get('message') or 'Repair request saved but email delivery failed.')

        return jsonify({
            'status': 'success',
            'new_state': 'Requested',
            'repairWorkflow': workflow,
            'emailDraft': {
                'to': email_recipient,
                'subject': email_subject,
                'body': email_body,
                'portalUrl': portal_url,
                'requestedContractorEmail': contractor_email
            },
            'emailDelivery': email_delivery,
            'notification': {
                'type': 'repair_requested',
                'message': f"Repair request routed to {email_recipient}."
            },
            'warning': warning_message
        }), 200
    except Exception as exc:
        print(f"Error creating repair request: {exc}")
        return jsonify({'error': str(exc)}), 500


@app.route('/api/repair/simulate', methods=['POST'])
def repair_simulate_update():
    """Dummy endpoint to simulate third-party contractor updates."""
    unauthorized = _require_admin_auth()
    if unauthorized is not None:
        return unauthorized

    payload = request.json or {}
    record_id = (payload.get('recordId') or '').strip()
    action = _normalize_status_key(payload.get('action') or '')

    if not record_id:
        return jsonify({'error': 'Missing recordId'}), 400
    if action not in {'accept', 'complete', 'reject'}:
        return jsonify({'error': 'Invalid action. Use accept, reject or complete.'}), 400

    target_status = 'In Progress' if action == 'accept' else 'Rejected' if action == 'reject' else 'Completed'
    target_state = 'in progress' if action == 'accept' else 'rejected' if action == 'reject' else 'completed'

    try:
        doc_ref = db.collection('hazard_records').document(record_id)
        snapshot = doc_ref.get()
        if not snapshot.exists:
            return jsonify({'error': 'recordId not found'}), 404

        report = snapshot.to_dict() or {}
        workflow = _compose_repair_workflow(
            report,
            target_state=target_state,
            actor='third_party_dummy',
            note='Updated by dummy contractor simulation from authority dashboard.'
        )

        if action == 'reject':
            # Re-queue rejected assignment back to authority queue for reassignment.
            doc_ref.update({
                'status': 'Verified',
                'verifiedAt': datetime.datetime.now(datetime.timezone.utc),
                'repairWorkflow': firestore.DELETE_FIELD
            })
            _append_repair_event_history(doc_ref, report, workflow.get('lastEvent'), record_id)
        else:
            doc_ref.update({
                'status': target_status,
                'verifiedAt': datetime.datetime.now(datetime.timezone.utc),
                'repairWorkflow': workflow
            })

        effective_status = 'Verified' if action == 'reject' else target_status
        updated_report = {
            **report,
            'status': effective_status,
            'repairWorkflow': workflow
        }
        reporter_notification = None
        if action == 'accept':
            reporter_notification = _notify_reporter_in_progress(record_id, updated_report, workflow, doc_ref)
        elif action == 'reject':
            reporter_notification = _notify_reporter_rejected(record_id, updated_report, workflow, doc_ref)
        elif action == 'complete':
            reporter_notification = _notify_reporter_issue_fixed(record_id, updated_report, workflow, doc_ref)

        return jsonify({
            'status': 'success',
            'new_state': effective_status,
            'repairWorkflow': None if action == 'reject' else workflow,
            'reporterNotification': reporter_notification,
            'notification': {
                'type': f"repair_{action}",
                'message': 'Dummy contractor rejected request. Report returned to Verified for reassignment.' if action == 'reject' else f"Dummy contractor marked report as {target_status}."
            }
        }), 200
    except Exception as exc:
        print(f"Error simulating repair update: {exc}")
        return jsonify({'error': str(exc)}), 500


@app.route('/api/repair/partner/<token>', methods=['GET', 'POST'])
def repair_partner_update(token):
    """Token-based partner action endpoint for future email-link flow.

    Expected JSON or form data: {"action": "accept"|"reject"|"complete"}
    """
    token_value = (token or '').strip()
    accept_header = (request.headers.get('Accept') or '').lower()
    requested_with = (request.headers.get('X-Requested-With') or '').lower()
    wants_json = request.is_json or ('application/json' in accept_header) or (requested_with == 'xmlhttprequest')
    if not token_value:
        return jsonify({'error': 'Missing partner token'}), 400

    try:
        snapshot, report = _find_report_by_partner_token(token_value)
        if not snapshot:
            if wants_json:
                return jsonify({'error': 'Invalid or expired token'}), 404
            if request.method == 'GET':
                return _partner_portal_html('unknown', {}, token_value, message='Invalid or expired token.', level='error'), 404
            return _partner_portal_html('unknown', {}, token_value, message='Invalid or expired token.', level='error'), 404

        if request.method == 'GET':
            if wants_json:
                workflow = report.get('repairWorkflow') if isinstance(report.get('repairWorkflow'), dict) else {}
                normalized_status = _normalize_status_key(report.get('status') or workflow.get('state') or 'requested')
                return jsonify({
                    'status': 'success',
                    'reportId': snapshot.id,
                    'token': token_value,
                    'report': {
                        'recordId': snapshot.id,
                        'status': report.get('status') or workflow.get('state') or 'Requested',
                        'finalHazardClass': report.get('finalHazardClass') or 'unknown',
                        'description': report.get('description') or '',
                        'mediaURL': report.get('mediaURL') or '',
                        'location': report.get('location') or {},
                        'repairWorkflow': workflow,
                        'partnerPortalUrl': workflow.get('partnerPortalUrl') or _repair_portal_url(token_value)
                    },
                    'workflow': {
                        'state': workflow.get('state') or report.get('status') or 'Requested',
                        'contractorEmail': workflow.get('contractorEmail') or DEFAULT_CONTRACTOR_EMAIL,
                        'contractorOrganizationName': workflow.get('contractorOrganizationName') or 'Simulation Contractor (Malaysia)',
                        'contractorOrganizationEmail': workflow.get('contractorOrganizationEmail') or DEFAULT_CONTRACTOR_EMAIL,
                        'contractorOrganizationType': workflow.get('contractorOrganizationType') or '',
                        'contractorOrganizationCoverage': workflow.get('contractorOrganizationCoverage') or '',
                        'contractorOrganizationContactPerson': workflow.get('contractorOrganizationContactPerson') or '',
                        'contractorOrganizationPhone': workflow.get('contractorOrganizationPhone') or '',
                        'partnerToken': token_value,
                        'partnerPortalUrl': workflow.get('partnerPortalUrl') or _repair_portal_url(token_value),
                        'events': workflow.get('events') or [],
                        'lastEvent': workflow.get('lastEvent') or None
                    },
                    'actions': {
                        'canAccept': normalized_status in {'requested', 'verified'},
                        'canReject': normalized_status in {'requested', 'verified'},
                        'canComplete': normalized_status in {'in progress'}
                    }
                }), 200
            return _partner_portal_html(snapshot.id, report, token_value)

        payload = request.get_json(silent=True) or request.form or {}
        action = _normalize_status_key(payload.get('action') or '')
        if action not in {'accept', 'complete', 'reject'}:
            if wants_json:
                return jsonify({'error': 'Invalid action. Use accept, reject or complete.'}), 400
            return _partner_portal_html(snapshot.id, report, token_value, message='Invalid action. Use accept, reject or complete.', level='error'), 400

        target_status = 'In Progress' if action == 'accept' else 'Rejected' if action == 'reject' else 'Completed'
        target_state = 'in progress' if action == 'accept' else 'rejected' if action == 'reject' else 'completed'
        contractor_note = (payload.get('note') or '').strip()
        completion_photo = request.files.get('completionPhoto')
        completion_photo_url = None
        if action == 'complete' and completion_photo and getattr(completion_photo, 'filename', ''):
            completion_photo_url = (_store_partner_attachment(snapshot.id, completion_photo, purpose='completed') or {}).get('url')

        doc_ref = snapshot.reference

        workflow = _compose_repair_workflow(
            report,
            target_state=target_state,
            actor='third_party_portal',
            note=contractor_note or 'Updated from partner portal token.'
        )

        if contractor_note:
            workflow['contractorNote'] = contractor_note
        if completion_photo_url:
            workflow['contractorPhotoURL'] = completion_photo_url
            workflow['completedPhotoURL'] = completion_photo_url

        if action == 'reject':
            # Re-queue rejected assignment back to authority queue for reassignment.
            doc_ref.update({
                'status': 'Verified',
                'verifiedAt': datetime.datetime.now(datetime.timezone.utc),
                'repairWorkflow': firestore.DELETE_FIELD
            })
            _append_repair_event_history(doc_ref, report, workflow.get('lastEvent'), snapshot.id)
        else:
            doc_ref.update({
                'status': target_status,
                'verifiedAt': datetime.datetime.now(datetime.timezone.utc),
                'repairWorkflow': workflow
            })

        effective_status = 'Verified' if action == 'reject' else target_status
        updated_report = {
            **report,
            'status': effective_status,
            'repairWorkflow': workflow
        }
        reporter_notification = None
        if action == 'accept':
            reporter_notification = _notify_reporter_in_progress(snapshot.id, updated_report, workflow, doc_ref)
        elif action == 'reject':
            reporter_notification = _notify_reporter_rejected(snapshot.id, updated_report, workflow, doc_ref)
        elif action == 'complete':
            reporter_notification = _notify_reporter_issue_fixed(snapshot.id, updated_report, workflow, doc_ref)

        report['status'] = effective_status
        report['repairWorkflow'] = {} if action == 'reject' else workflow

        if not wants_json:
            portal_message = 'Request rejected. Returned to authority queue for reassignment.' if action == 'reject' else f'Status updated to {target_status}.'
            return _partner_portal_html(snapshot.id, report, token_value, message=portal_message, level='success'), 200

        return jsonify({
            'status': 'success',
            'recordId': snapshot.id,
            'new_state': effective_status,
            'repairWorkflow': None if action == 'reject' else workflow,
            'reporterNotification': reporter_notification
        }), 200
    except Exception as exc:
        print(f"Error handling partner update: {exc}")
        return jsonify({'error': str(exc)}), 500

@app.route('/api/feedback_detection', methods=['POST'])
def feedback_detection():
    """
    Save human feedback on AI hazard classification.
    Expected JSON:
    {
      "recordId": "...",
      "isCorrect": true|false,
      "correctedClass": "longitudinal_crack" (required when isCorrect=false),
      "note": "optional"
    }
    """
    unauthorized = _require_admin_auth()
    if unauthorized is not None:
        return unauthorized

    payload = request.json or {}
    record_id = (payload.get('recordId') or '').strip()
    is_correct_raw = payload.get('isCorrect')
    corrected_class = _normalize_hazard_label(payload.get('correctedClass') or '')
    predicted_class_override = _normalize_hazard_label(payload.get('predictedClass') or '')
    target_detection_index_raw = payload.get('targetDetectionIndex')
    target_detection_bbox_raw = payload.get('targetDetectionBBox')
    target_detection_bboxes_raw = payload.get('targetDetectionBBoxes')
    note = (payload.get('note') or '').strip()

    if not record_id:
        return jsonify({"error": "Missing recordId"}), 400
    if not isinstance(is_correct_raw, bool):
        return jsonify({"error": "isCorrect must be boolean"}), 400

    if not is_correct_raw and corrected_class not in HAZARD_CLASSES:
        return jsonify({"error": f"correctedClass must be one of {sorted(HAZARD_CLASSES)}"}), 400

    target_detection_index = None
    if target_detection_index_raw is not None and target_detection_index_raw != '':
        try:
            target_detection_index = int(target_detection_index_raw)
        except Exception:
            return jsonify({"error": "targetDetectionIndex must be an integer"}), 400

    target_detection_bbox = None
    if isinstance(target_detection_bbox_raw, dict):
        target_detection_bbox = _normalize_feedback_bbox(target_detection_bbox_raw)
        if not target_detection_bbox:
            return jsonify({"error": "targetDetectionBBox must contain normalized x, y, width, height"}), 400

    target_detection_bboxes = _normalize_feedback_bboxes(target_detection_bboxes_raw, target_detection_bbox_raw)
    if target_detection_bboxes_raw is not None and not target_detection_bboxes:
        return jsonify({"error": "targetDetectionBBoxes must contain one or more normalized boxes"}), 400

    try:
        doc_ref = db.collection('hazard_records').document(record_id)
        snapshot = doc_ref.get()
        if not snapshot.exists:
            return jsonify({"error": "recordId not found"}), 404

        report = snapshot.to_dict() or {}
        detections = report.get('detections') or []
        image_fingerprint = (report.get('imageFingerprint') or '').strip()
        if target_detection_index is not None and (target_detection_index < 0 or target_detection_index >= len(detections)):
            return jsonify({"error": "targetDetectionIndex out of range for detections"}), 400

        if target_detection_index is not None and len(detections) > 0:
            top = detections[target_detection_index] or {}
        else:
            top = _top_detection(detections) or {}
        predicted_class = _normalize_hazard_label(top.get('class') or 'other')
        if predicted_class_override in HAZARD_CLASSES:
            predicted_class = predicted_class_override

        final_class = predicted_class if is_correct_raw else corrected_class
        if final_class not in HAZARD_CLASSES:
            final_class = 'other'

        now = datetime.datetime.now()
        feedback_payload = {
            'recordId': record_id,
            'mediaURL': report.get('mediaURL'),
            'detections': detections,
            'predictedClass': predicted_class,
            'imageFingerprint': image_fingerprint,
            'targetDetectionIndex': target_detection_index,
            'targetDetectionBBox': target_detection_bbox or (target_detection_bboxes[0] if target_detection_bboxes else None),
            'targetDetectionBBoxes': target_detection_bboxes or [],
            'isCorrect': bool(is_correct_raw),
            'correctedClass': corrected_class if not is_correct_raw else predicted_class,
            'finalClass': final_class,
            'note': note,
            'usedForTraining': False,
            'createdAt': now,
            'location': report.get('location') or {}
        }

        db.collection('training_feedback').add(feedback_payload)

        update_payload = {
            'finalHazardClass': final_class,
            'aiFeedback': {
                'isCorrect': bool(is_correct_raw),
                'predictedClass': predicted_class,
                'targetDetectionIndex': target_detection_index,
                'targetDetectionBBox': target_detection_bbox or (target_detection_bboxes[0] if target_detection_bboxes else None),
                'targetDetectionBBoxes': target_detection_bboxes or [],
                'correctedClass': corrected_class if not is_correct_raw else predicted_class,
                'finalClass': final_class,
                'note': note,
                'updatedAt': now
            },
            'aiFeedbackUpdatedAt': now
        }
        if final_class == 'not_hazard':
            update_payload['status'] = 'Rejected'

        doc_ref.update(update_payload)

        archive_path = None
        try:
            archive_path = _archive_remote_image_to_dataset(
                media_url=report.get('mediaURL'),
                record_id=record_id,
                hazard_class=final_class,
                source_tag='feedback'
            )
        except Exception as archive_error:
            print(f"[DATASET-ARCHIVE] Feedback archive failed for {record_id}: {archive_error}")

        if archive_path:
            try:
                doc_ref.update({
                    'datasetArchive': {
                        'latestPath': archive_path,
                        'latestClass': final_class,
                        'updatedAt': now
                    }
                })
            except Exception as archive_meta_error:
                print(f"[DATASET-ARCHIVE] Could not update archive metadata for {record_id}: {archive_meta_error}")

        retrain_started, retrain_state = _maybe_trigger_auto_retrain()
        retrain_status = _current_auto_retrain_status()

        return jsonify({
            'status': 'success',
            'recordId': record_id,
            'finalClass': final_class,
            'datasetArchivePath': archive_path,
            'feedbackSaved': True,
            'pendingFeedbackCount': retrain_status.get('pendingFeedbackCount', 0),
            'autoRetrain': {
                **retrain_status,
                'started': retrain_started,
                'state': retrain_state,
                'threshold': AUTO_RETRAIN_MIN_FEEDBACK
            }
        }), 200
    except Exception as e:
        print(f"Error saving AI feedback: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/retrain_now', methods=['POST'])
def retrain_now():
    """Manually trigger auto-retrain check/start using current pending feedback."""
    unauthorized = _require_admin_auth()
    if unauthorized is not None:
        return unauthorized

    try:
        started, state = _maybe_trigger_auto_retrain()
        retrain_status = _current_auto_retrain_status()
        return jsonify({
            'status': 'success',
            'started': started,
            'state': state,
            'pendingFeedbackCount': retrain_status.get('pendingFeedbackCount', 0),
            'cooldownRemainingSec': retrain_status.get('cooldownRemainingSec', 0),
            'threshold': AUTO_RETRAIN_MIN_FEEDBACK,
            'enabled': AUTO_RETRAIN_ON_FEEDBACK,
            'autoRetrain': {
                **retrain_status,
                'started': started,
                'state': state,
                'threshold': AUTO_RETRAIN_MIN_FEEDBACK
            }
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/dataset_label_counts', methods=['GET'])
def dataset_label_counts():
    try:
        summary = _compute_dataset_label_counts()
        return jsonify({
            'status': 'success',
            **summary
        }), 200
    except Exception as count_error:
        return jsonify({'error': str(count_error)}), 500

@app.route('/api/dataset_labels_zip', methods=['GET'])
def dataset_labels_zip():
    unauthorized = _require_admin_auth()
    if unauthorized is not None:
        return unauthorized

    corrected_only = str(request.args.get('correctedOnly', '1')).strip().lower() in {'1', 'true', 'yes', 'on'}

    try:
        zip_path, counts, total_files = _create_dataset_labels_zip(corrected_only=corrected_only)
        if not zip_path:
            return jsonify({
                'error': 'No matching images found for ZIP export.',
                'correctedOnly': corrected_only,
                'counts': counts,
                'totalFiles': total_files
            }), 404

        suffix = 'corrected' if corrected_only else 'all'
        filename = f"dataset_labels_{suffix}_{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d_%H%M%S')}.zip"

        # Return the generated archive directly so hosted deployments do not depend on
        # a second Cloud Storage upload or signed URL generation step.
        response = send_file(
            zip_path,
            mimetype='application/zip',
            as_attachment=True,
            download_name=filename
        )

        def _cleanup_zip():
            try:
                os.remove(zip_path)
            except Exception:
                pass

        response.call_on_close(_cleanup_zip)
        return response
    except Exception as zip_error:
        return jsonify({'error': str(zip_error)}), 500

@app.route('/api/augment_submissions', methods=['POST'])
def augment_submissions():
    """Generate tropical-weather augmented samples from submitted reports and optionally trigger retrain."""
    unauthorized = _require_admin_auth()
    if unauthorized is not None:
        return unauthorized

    payload = request.json or {}
    try:
        max_items = int(payload.get('maxItems', 3))
    except Exception:
        return jsonify({'error': 'maxItems must be an integer'}), 400

    max_items = max(1, min(max_items, 20))
    trigger_retrain = bool(payload.get('triggerRetrain', False))
    source_record_id = (payload.get('sourceRecordId') or '').strip()
    include_confidence = bool(payload.get('includeConfidence', False)) and AUGMENT_INCLUDE_CONFIDENCE
    controls = payload.get('controls') or {}

    try:
        summary = _augment_submitted_reports(max_items=max_items)

        retrain_started = False
        retrain_state = 'not_requested'
        # _current_auto_retrain_status() can be expensive due pending feedback counting.
        # Avoid it on normal augmentation requests unless retrain is explicitly requested.
        retrain_status = {
            'enabled': AUTO_RETRAIN_ON_FEEDBACK,
            'running': False,
            'ready': False,
            'lastState': None,
            'lastStartedAt': None,
            'lastCompletedAt': None,
            'cooldownRemainingSec': 0,
            'pendingFeedbackCount': 0,
            'minFeedback': AUTO_RETRAIN_MIN_FEEDBACK,
        }
        if trigger_retrain:
            retrain_started, retrain_state = _maybe_trigger_auto_retrain()
            retrain_status = _current_auto_retrain_status()

        resolved_source_record_id = ''
        confidence_analysis = {
            'recordId': None,
            'scenarios': [],
            'skipped': True,
            'reason': 'Confidence analysis disabled for fast augmentation response.'
        }
        # Confidence inference is expensive and can exceed Hosting proxy time budget.
        # Run only when explicitly requested and enabled by env.
        if include_confidence and source_record_id:
            resolved_source_record_id = _resolve_confidence_source_record_id(source_record_id)
            confidence_analysis['recordId'] = resolved_source_record_id or None
            confidence_analysis['skipped'] = False
            confidence_analysis['reason'] = None
            if resolved_source_record_id:
                try:
                    confidence_analysis = _compute_augmentation_confidence(resolved_source_record_id, controls=controls)
                except Exception as confidence_error:
                    confidence_analysis = {
                        'recordId': resolved_source_record_id,
                        'scenarios': [],
                        'skipped': False,
                        'error': str(confidence_error)
                    }
            else:
                confidence_analysis = {
                    'recordId': None,
                    'scenarios': [],
                    'skipped': False,
                    'error': 'Selected source record is unavailable or has no media image.'
                }

        if not isinstance(confidence_analysis.get('scenarios'), list):
            confidence_analysis['scenarios'] = []

        return jsonify({
            'status': 'success',
            'augmentation': summary,
            'confidenceSourceRecordId': resolved_source_record_id or None,
            'confidenceAnalysis': confidence_analysis,
            'retrainStarted': retrain_started,
            'retrainState': retrain_state,
            'autoRetrain': {
                **retrain_status,
                'started': retrain_started,
                'state': retrain_state,
                'threshold': AUTO_RETRAIN_MIN_FEEDBACK
            }
        }), 200
    except Exception as augmentation_error:
        return jsonify({'error': str(augmentation_error)}), 500

@app.route('/api/retrain_status', methods=['GET'])
def retrain_status():
    """Fast retrain status endpoint for dashboard polling (no model load check)."""
    unauthorized = _require_admin_auth()
    if unauthorized is not None:
        return unauthorized

    try:
        status = _current_auto_retrain_status()
        return jsonify({
            'status': 'success',
            'autoRetrain': status
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health():
    """Lightweight health check for connectivity and readiness."""
    try:
        include_model_check = str(request.args.get('include_model', '0')).strip().lower() in {'1', 'true', 'yes', 'on'}
        model_status = "not_loaded"
        model_error = model_load_error
        if include_model_check:
            try:
                get_model()
                model_status = "ok"
                model_error = None
            except Exception as e:
                model_status = "error"
                model_error = str(e)
        else:
            if model is not None:
                model_status = "ok_cached"

        docs = db.collection('hazard_records').limit(1).stream()
        sample = None
        for d in docs:
            sample = d.id
            break

        retrain_status = _current_auto_retrain_status()

        return jsonify({
            "status": "ok",
            "service": "flask",
            "firestore": "ok",
            "model": model_status,
            "modelCheckPerformed": include_model_check,
            "modelPath": MODEL_PATH,
            "inference": {
                "conf": INFER_CONF,
                "iou": INFER_IOU,
                "class_conf": INFER_CLASS_CONF,
                "crack_subtype_min_conf": INFER_CRACK_SUBTYPE_MIN_CONF,
                "pothole_reclassify_linear_min_advantage": INFER_POTHOLE_RECLASSIFY_LINEAR_MIN_ADVANTAGE,
                "pothole_reclassify_linear_min_crack_conf": INFER_POTHOLE_RECLASSIFY_LINEAR_MIN_CRACK_CONF
            },
            "autoRetrain": {
                **retrain_status
            },
            "modelError": model_error or model_load_error,
            "sampleRecordId": sample,
        }), 200
    except Exception as e:
        return jsonify({
            "status": "degraded",
            "service": "flask",
            "firestore": "error",
            "error": str(e)
        }), 200

if __name__ == '__main__':
    use_ssl = os.getenv('USE_SSL', '').lower() == 'true'
    debug_enabled = os.getenv('FLASK_DEBUG', '0') in ('1', 'true', 'True')
    
    if use_ssl:
        cert_path = os.getenv('SSL_CERT')
        key_path = os.getenv('SSL_KEY')
        if not cert_path or not key_path:
            print("ERROR: SSL_CERT and SSL_KEY env vars must be set. Use start_flask_ssl.ps1")
            exit(1)
        if not os.path.exists(cert_path) or not os.path.exists(key_path):
            print(f"ERROR: Cert files not found:\n  {cert_path}\n  {key_path}")
            exit(1)
        print(f"Loading SSL certs:\n  Cert: {cert_path}\n  Key: {key_path}")
        ssl_ctx = (cert_path, key_path)
    else:
        ssl_ctx = None
    
    app.run(debug=debug_enabled, use_reloader=debug_enabled, port=5000, host='0.0.0.0', ssl_context=ssl_ctx)
