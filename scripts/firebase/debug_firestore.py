#!/usr/bin/env python3
"""
Debug script to inspect all hazard records and their finalHazardClass values.
"""

import os
import sys
from pathlib import Path
from collections import Counter

# Firebase setup
import firebase_admin
from firebase_admin import credentials, firestore

# Initialize Firebase
creds_path = Path(__file__).resolve().parents[2] / 'firebase_credentials.json'
if not creds_path.exists():
    print(f"[-] Error: {creds_path} not found")
    sys.exit(1)

try:
    firebase_admin.initialize_app(credentials.Certificate(str(creds_path)))
except ValueError:
    # Already initialized
    pass

db = firestore.client()

print("[*] Querying all hazard records...")
all_docs = db.collection('hazard_records').stream()

hazard_classes = Counter()
records_info = []

for doc in all_docs:
    data = doc.to_dict()
    final_class = data.get('finalHazardClass', 'MISSING')
    hazard_classes[final_class] += 1
    records_info.append({
        'id': doc.id,
        'finalHazardClass': final_class,
        'timestamp': data.get('timestamp'),
        'status': data.get('status')
    })

print(f"\n[INFO] Total records: {len(records_info)}")
print(f"\n[INFO] Hazard class distribution:")
for cls, count in hazard_classes.most_common():
    print(f"  {cls}: {count}")

# Show all 'not_hazard' records if any
not_hazard_records = [r for r in records_info if r['finalHazardClass'] == 'not_hazard']
if not_hazard_records:
    print(f"\n[*] Found {len(not_hazard_records)} 'not_hazard' records:")
    for r in not_hazard_records:
        print(f"  {r['id']}: {r['finalHazardClass']}")

# Check for variations
print(f"\n[*] Checking for name variations...")
all_classes = set(hazard_classes.keys())
print(f"  All unique classes: {all_classes}")
