#!/usr/bin/env python3
"""
Delete all 'not_hazard' records from Firestore (normalized from transverse_crack detections).
Also removes corresponding local dataset files.
"""

import os
import sys
import shutil
from pathlib import Path

# Firebase setup
import firebase_admin
from firebase_admin import credentials, firestore

# Initialize Firebase
creds_path = Path(__file__).resolve().parents[2] / 'firebase_credentials.json'
if not creds_path.exists():
    print(f"❌ Error: {creds_path} not found")
    sys.exit(1)

try:
    firebase_admin.initialize_app(credentials.Certificate(str(creds_path)))
except ValueError:
    # Already initialized
    pass

db = firestore.client()

print("[*] Querying Firestore records that normalize to 'not_hazard'...")
print("    - Querying 'transverse_crack' records (will normalize to not_hazard)...")
transverse_docs = list(db.collection('hazard_records').where('finalHazardClass', '==', 'transverse_crack').stream())
print(f"      Found: {len(transverse_docs)} transverse_crack records")

records_to_delete = transverse_docs
print(f"\n[*] Records that will be deleted:")
for doc in transverse_docs:
    print(f"  {doc.id}")

if not records_to_delete:
    print("[+] No records to delete.")
    sys.exit(0)

count = len(records_to_delete)
print(f"\n[INFO] Total records to delete: {count} transverse_crack records")

# Confirm deletion
response = input(f"\n[!] Are you sure you want to delete {count} records? This cannot be undone. (yes/no): ").lower().strip()
if response != 'yes':
    print("[-] Cancelled.")
    sys.exit(0)

# Delete from Firestore
print(f"\n[*] Deleting {count} records from Firestore...")
deleted_count = 0
for doc in records_to_delete:
    try:
        db.collection('hazard_records').document(doc.id).delete()
        print(f"  [OK] Deleted: {doc.id}")
        deleted_count += 1
    except Exception as e:
        print(f"  [ERR] Failed to delete {doc.id}: {e}")

print(f"\n[+] Deleted {deleted_count}/{count} records from Firestore")

# Clean up local dataset folders
dataset_base = Path(__file__).resolve().parents[2] / 'datasets' / 'road_hazards_combined' / 'submitted_by_class'

# Check for 'not_hazard' folder (in case it was created)
not_hazard_folder = dataset_base / 'not_hazard'
if not_hazard_folder.exists():
    print(f"\n[*] Removing local dataset folder: {not_hazard_folder}")
    try:
        shutil.rmtree(not_hazard_folder)
        print(f"  [OK] Deleted: {not_hazard_folder}")
    except Exception as e:
        print(f"  [ERR] Failed to delete {not_hazard_folder}: {e}")

# Also clean up transverse_crack folder if it exists (these were the originals)
transverse_folder = dataset_base / 'transverse_crack'
if transverse_folder.exists():
    print(f"\n[*] Removing local transverse_crack dataset folder: {transverse_folder}")
    response = input("  Delete transverse_crack local files too? (yes/no): ").lower().strip()
    if response == 'yes':
        try:
            shutil.rmtree(transverse_folder)
            print(f"  [OK] Deleted: {transverse_folder}")
        except Exception as e:
            print(f"  [ERR] Failed to delete {transverse_folder}: {e}")
    else:
        print("  [SKIP] Skipped transverse_crack folder")

print("\n[+] Cleanup complete!")
