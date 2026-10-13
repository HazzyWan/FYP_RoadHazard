// Lightweight Firebase initializer for frontend real-time updates.
// Reads Vite env vars (VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID,
// VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID)
// If the minimal config isn't present, exports `hasFirebase=false` so callers can fallback.

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const env = import.meta.env;

const projectId = env.VITE_FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT || '';
const apiKey = env.VITE_FIREBASE_API_KEY || '';
const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`;
const storageBucket = env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`;
const messagingSenderId = env.VITE_FIREBASE_MESSAGING_SENDER_ID || '';
const appId = env.VITE_FIREBASE_APP_ID || '';

let hasFirebase = false;
let db = null;

try {
  if (projectId && apiKey) {
    const firebaseConfig = {
      apiKey,
      authDomain,
      projectId,
      storageBucket,
      messagingSenderId,
      appId
    };

    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    hasFirebase = true;
  }
} catch (err) {
  // Initialization failed; keep hasFirebase=false so frontend falls back gracefully.
  console.warn('Firebase init failed or missing Vite env vars:', err && err.message ? err.message : err);
}

export { hasFirebase, db };
