#!/usr/bin/env python3
import urllib.request
import urllib.error

import firebase_admin
from firebase_admin import credentials, firestore

CRED = 'c:/Users/Ahmad Hazwan Syauqee/Documents/FYP_RoadHazard/firebase_credentials.json'


def check_url(url: str) -> int:
    req = urllib.request.Request(url, method='HEAD')
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return int(getattr(resp, 'status', 200))
    except urllib.error.HTTPError as e:
        return int(getattr(e, 'code', 0) or 0)
    except Exception:
        # HEAD may fail on some hosts; fallback lightweight GET
        req2 = urllib.request.Request(url, headers={'Range': 'bytes=0-0'})
        try:
            with urllib.request.urlopen(req2, timeout=8) as resp:
                return int(getattr(resp, 'status', 200))
        except urllib.error.HTTPError as e:
            return int(getattr(e, 'code', 0) or 0)
        except Exception:
            return -1


def main():
    try:
        firebase_admin.initialize_app(credentials.Certificate(CRED))
    except ValueError:
        pass

    db = firestore.client()
    ok = 0
    missing = 0
    failed = 0
    missing_ids = []

    for doc in db.collection('hazard_records').stream():
        data = doc.to_dict() or {}
        url = str(data.get('mediaURL') or '').strip()
        if not url:
            continue
        code = check_url(url)
        if code == 200 or code == 206:
            ok += 1
        elif code == 404:
            missing += 1
            missing_ids.append(doc.id)
        else:
            failed += 1

    print(f'http_ok={ok}')
    print(f'http_404_missing={missing}')
    print(f'http_other_failures={failed}')
    if missing_ids:
        print('missing_ids_sample=')
        for rid in missing_ids[:30]:
            print(rid)


if __name__ == '__main__':
    main()
