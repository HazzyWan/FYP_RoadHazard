#!/usr/bin/env python3
from urllib.parse import urlparse, unquote

import firebase_admin
from firebase_admin import credentials, firestore, storage

CRED = 'c:/Users/Ahmad Hazwan Syauqee/Documents/FYP_RoadHazard/firebase_credentials.json'
BUCKET = 'roadhazard-fyp.firebasestorage.app'


def extract_blob_name(media_url: str):
    if not media_url:
        return None
    url = urlparse(media_url)
    path = url.path or ''
    marker = '/o/'
    idx = path.find(marker)
    if idx >= 0:
        return unquote(path[idx + len(marker):])
    if '/hazards/' in path:
        tail = path.split('/hazards/', 1)[1]
        return f'hazards/{tail}' if tail else None
    return None


def main():
    try:
        firebase_admin.initialize_app(credentials.Certificate(CRED), {'storageBucket': BUCKET})
    except ValueError:
        pass

    db = firestore.client()
    bucket = storage.bucket()

    existing = 0
    missing = []
    unparseable = []

    for doc in db.collection('hazard_records').stream():
        payload = doc.to_dict() or {}
        media_url = str(payload.get('mediaURL') or '').strip()
        if not media_url:
            continue

        blob_name = extract_blob_name(media_url)
        if not blob_name:
            unparseable.append(doc.id)
            continue

        if bucket.blob(blob_name).exists():
            existing += 1
        else:
            missing.append((doc.id, blob_name))

    print(f'existing_media={existing}')
    print(f'missing_media={len(missing)}')
    print(f'unparseable_urls={len(unparseable)}')
    if missing:
        print('missing_sample=')
        for item in missing[:30]:
            print(item)


if __name__ == '__main__':
    main()
