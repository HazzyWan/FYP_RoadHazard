#!/usr/bin/env python3
"""Cleanup utility for Firebase Storage hazard images.

Features:
- Deletes objects under hazards/ older than N days.
- Optional: deletes hazard_records Firestore docs whose mediaURL points to deleted objects.
- Dry-run by default for safety.
"""

from __future__ import annotations

import argparse
import datetime as dt
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import firebase_admin
from firebase_admin import credentials, firestore, storage


DEFAULT_BUCKET = "roadhazard-fyp.firebasestorage.app"
DEFAULT_PREFIX = "hazards/"


@dataclass
class BlobInfo:
    name: str
    updated: dt.datetime
    size: int


def _init_firebase(project_root: Path, bucket_name: str) -> None:
    cred_path = project_root / "firebase_credentials.json"
    if not cred_path.exists():
        raise FileNotFoundError(f"Missing credential file: {cred_path}")

    if not firebase_admin._apps:
        firebase_admin.initialize_app(
            credentials.Certificate(str(cred_path)),
            {"storageBucket": bucket_name},
        )


def _iter_old_blobs(bucket, prefix: str, older_than_days: int) -> Iterable[BlobInfo]:
    now = dt.datetime.now(dt.timezone.utc)
    cutoff = now - dt.timedelta(days=older_than_days)

    for blob in bucket.list_blobs(prefix=prefix):
        updated = getattr(blob, "updated", None)
        if not updated:
            continue
        if updated <= cutoff:
            yield BlobInfo(name=blob.name, updated=updated, size=int(blob.size or 0))


def _iter_all_blobs(bucket, prefix: str) -> Iterable[BlobInfo]:
    for blob in bucket.list_blobs(prefix=prefix):
        updated = getattr(blob, "updated", None)
        if not updated:
            continue
        yield BlobInfo(name=blob.name, updated=updated, size=int(blob.size or 0))


def _iter_excess_blobs_keep_latest(bucket, prefix: str, keep_latest: int) -> Iterable[BlobInfo]:
    all_blobs = sorted(_iter_all_blobs(bucket, prefix), key=lambda x: x.updated, reverse=True)
    # Keep the newest N files, delete the rest (older files only).
    return sorted(all_blobs[keep_latest:], key=lambda x: x.updated)


def _remove_matching_docs(deleted_file_names: set[str]) -> int:
    db = firestore.client()
    to_delete = []

    for doc in db.collection("hazard_records").stream():
        payload = doc.to_dict() or {}
        media_url = str(payload.get("mediaURL") or "").strip()
        if not media_url:
            continue
        tail = media_url.rsplit("/", 1)[-1].split("?", 1)[0]
        if tail in deleted_file_names:
            to_delete.append(doc.id)

    for doc_id in to_delete:
        db.collection("hazard_records").document(doc_id).delete()

    return len(to_delete)


def main() -> int:
    parser = argparse.ArgumentParser(description="Delete old hazard images from Firebase Storage.")
    parser.add_argument("--days", type=int, help="Delete files older than this many days.")
    parser.add_argument(
        "--keep-latest",
        type=int,
        help="Keep newest N files in prefix and delete older files beyond that count.",
    )
    parser.add_argument("--bucket", default=DEFAULT_BUCKET, help="Firebase Storage bucket name.")
    parser.add_argument("--prefix", default=DEFAULT_PREFIX, help="Storage prefix to clean.")
    parser.add_argument(
        "--delete-firestore-records",
        action="store_true",
        help="Also delete hazard_records documents that reference deleted files.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply deletion. If omitted, only prints what would be deleted.",
    )
    args = parser.parse_args()

    if args.days is not None and args.keep_latest is not None:
        raise SystemExit("Use only one mode: --days or --keep-latest")
    if args.days is None and args.keep_latest is None:
        args.days = 180
    if args.keep_latest is not None and args.keep_latest < 0:
        raise SystemExit("--keep-latest must be >= 0")

    project_root = Path(__file__).resolve().parents[2]
    _init_firebase(project_root, args.bucket)

    bucket = storage.bucket()
    if args.keep_latest is not None:
        candidates = list(_iter_excess_blobs_keep_latest(bucket, args.prefix, args.keep_latest))
        mode_text = f"keep-latest mode (keeping newest {args.keep_latest})"
    else:
        candidates = sorted(
            _iter_old_blobs(bucket, args.prefix, args.days),
            key=lambda x: x.updated,
        )
        mode_text = f"age mode (older than {args.days} days)"

    total_size = sum(item.size for item in candidates)
    print(f"Mode: {mode_text}")
    print(f"Candidates: {len(candidates)}")
    print(f"Total size: {total_size} bytes")
    for item in candidates[:50]:
        print(f"- {item.updated.isoformat()} | {item.name} | {item.size} bytes")
    if len(candidates) > 50:
        print(f"... and {len(candidates) - 50} more")

    if not args.apply:
        print("Dry-run only. Re-run with --apply to delete these files.")
        return 0

    deleted_names: set[str] = set()
    deleted_count = 0
    freed_bytes = 0
    for item in candidates:
        blob = bucket.blob(item.name)
        blob.delete()
        deleted_count += 1
        freed_bytes += item.size
        deleted_names.add(item.name.rsplit("/", 1)[-1])

    print(f"Deleted files: {deleted_count}")
    print(f"Freed bytes: {freed_bytes}")

    if args.delete_firestore_records and deleted_names:
        deleted_docs = _remove_matching_docs(deleted_names)
        print(f"Deleted Firestore docs: {deleted_docs}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
