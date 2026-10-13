# Test Cases — Frontend UI (PWA)

This file lists the UI-facing test cases for manual and automated verification. Each test case follows the table layout used in the example test matrix: Test Case ID, Test Case Name, Special Condition, Test Scenario, Test Steps, Test Data, Expected Result, Actual Result, Pass/Fail and Evidence.

Notes:
- Fill `Actual Result`, `Pass/Fail`, and `Evidence` during execution.
- Test Case IDs map to API / automated tests where applicable (store artifacts in `tests/artifacts/`).

---

## TC01 — Upload: Valid image

| Field | Details |
|---|---|
| Test Case ID | TC01 |
| Test Case Name | Upload: Valid image |
| Special Condition | App open; user has camera file; network available |
| Expected Result | UI shows a success screen ("Report Submitted!"), the token is persisted in LocalStorage under the key `roadhazard_reporter_token`, and the new submission appears in `My Submissions` (or after a short backend index delay). |
| Test Steps | 1. Open `Report` UI  2. Attach valid image (JPEG < 10 MB, with optional EXIF)  3. Fill optional description  4. Submit |
| Test Data | Valid JPEG image (optionally geo-tagged) |
| Expected Result | UI shows confirmation (e.g., “Successfully submitted!”); `token` saved to LocalStorage; new submission appears in the user's "My Submissions" list and is visible in the admin reports list within a short time. |
| Actual Result |  |
| Evidence | API response JSON; Firestore doc path |

---

## TC02 — Upload: Invalid file

| Field | Details |
|---|---|
| Test Case ID | TC02 |
| Test Case Name | Upload: Invalid file |
| Special Condition | App open; file is malformed or wrong mime type |
| Expected Result | UI shows a clear error/toast (e.g., "Invalid file type" or "Upload failed. Please try again."); the submission is rejected and no new report is created. |
| Test Steps | 1. Open `Report` UI  2. Attach non-image file (e.g., .txt) or corrupted image  3. Submit |
| Test Data | Corrupted image or non-image file |
| Expected Result | UI shows a clear error message (e.g., "Invalid file type" or "Upload failed"); no new submission appears in the user's list or admin reports. |
| Actual Result |  |
| Evidence | API response; absence of new Firestore doc |

---

## TC03 — Token Loop

| Field | Details |
|---|---|
| Test Case ID | TC03 |
| Test Case Name | Token Loop |
| Special Condition | First upload completed; LocalStorage available |
| Expected Result | Detail view displays the submitted image, hazard label(s), description, timestamp and status; bounding-box overlays are not shown in the public detail modal (map pins appear in the Map view / MapPanel). Media should load successfully. |
| Test Steps | 1. Perform initial successful upload (TC01)  2. Confirm `token` stored in LocalStorage  3. Submit a second upload from same browser/session |
| Test Data | Use `token` returned from first upload |
| Expected Result | UI continues to show the same identity (no new onboarding); `token` remains in LocalStorage; subsequent submissions appear under the same "My Submissions" list entry. |
| Actual Result |  |
| Evidence | LocalStorage value; Firestore doc id consistency |

---

## TC04 — My Submissions: View list

| Field | Details |
|---|---|
| Test Case ID | TC04 |
| Test Case Name | My Submissions: View list |
| Special Condition | `token` present in browser storage |
| Expected Result | EXIF GPS is extracted and sent to the backend (Firestore `location` / `location_address` fields). The UI indicates `Photo EXIF` as the source; a map pin is visible in the Map view (MapPanel). |
| Test Steps | 1. Open `My Submissions` UI  2. Ensure UI sends `token` param to the My Submissions endpoint  3. Observe list rendering |
| Test Data | N/A |
| Expected Result | The "My Submissions" page displays the user's submissions with thumbnails, statuses, and timestamps; clicking an item opens the detail view. |
| Actual Result |  |
| Evidence | API response; screenshot of UI list |

---

## TC05 — Report Details & Media

| Field | Details |
|---|---|
| Test Case ID | TC05 |
| Test Case Name | Report Details & Media |
| Special Condition | Record exists in Firestore |
| Expected Result | Feedback flows are handled by the backend/training side and are exposed in the Admin Dashboard. After feedback is submitted via the dashboard, the UI shows confirmation and the feedback is stored for training. (Note: public users do not have an in-site feedback correction form; corrections are made via the admin interface.) |
| Test Steps | 1. Open `My Submissions`  2. Click a record  3. Inspect detail page |
| Test Data | Existing `recordId` |
| Expected Result | Detail view displays the submitted image, overlaid detection boxes/labels (if shown), location/map pin (if present), description, and current status; media loads successfully. |
| Actual Result |  |
| Evidence | Screenshot; Firestore doc path |

---

## TC06 — EXIF Location Parsing

| Field | Details |
|---|---|
| Test Case ID | TC06 |
| Test Case Name | EXIF Location Parsing |
| Special Condition | Image contains GPS EXIF metadata |
| Expected Result | The partner portal is loaded via a partner repair iframe; contractor actions (accept/complete/reject) are performed there and persisted by the backend. After a partner action the admin dashboard will reflect the updated assignment/state. |
## Test Cases — Consolidated UI & Integration Matrix

This file lists concise, non-redundant test cases for the main public, admin, partner and ML/ops features. Fill `Actual Result`, `Pass/Fail`, and `Evidence` during execution. Store evidence under `tests/artifacts/{TCID}/`.

Guidelines:
- When possible map UI test cases to API-level checks in `tests/api/` and E2E scripts in `tests/e2e/`.
- Keep each test case focused on a single behavior (no overlapping expectations).

---

## TC01 — Upload: happy path

| Field | Details |
|---|---|
| Test Case ID | TC01 |
| Test Case Name | Upload: happy path |
| Special Condition | App open; network available; image file ready |
| Test Scenario | Submit an image with location and optional description; verify UI and persistence |
| Test Steps | 1. Open `Report` UI  2. Choose a valid image  3. Allow location / accept EXIF or manual entry  4. Save contact (optional)  5. Submit |
| Test Data | JPEG image (<10MB), with or without EXIF GPS |
| Expected Result | Success screen shown ("Report Submitted!"); `roadhazard_reporter_token` saved in LocalStorage; the backend upload returns a token and report id; new entry appears in `My Submissions` within a short time. |
| Actual Result |  |
| Pass/Fail |  |
| Evidence | API response; LocalStorage key; screenshot of success and `My Submissions` entry |

---

## TC02 — Upload: invalid input

| Field | Details |
|---|---|
| Test Case ID | TC02 |
| Test Case Name | Upload: invalid input |
| Special Condition | Malformed file or unsupported mime type |
| Test Scenario | Attempt to upload a non-image or corrupted file |
| Test Steps | 1. Open `Report` UI  2. Select a non-image file or corrupted image  3. Submit |
| Test Data | .txt file or broken JPEG |
| Expected Result | The UI shows a clear error/toast; backend rejects upload; no report created. |
| Actual Result |  |
| Pass/Fail |  |
| Evidence | API error response; no Firestore record |

---

## TC03 — Location extraction priority (EXIF → device GPS → manual)

| Field | Details |
|---|---|
| Test Case ID | TC03 |
| Test Case Name | Location extraction priority |
| Special Condition | Image with EXIF, and device GPS available or not |
| Test Scenario | Verify frontend chooses EXIF first, then device GPS captured at photo time, then manual entry |
| Test Steps | 1. Select image with EXIF GPS → observe `Photo EXIF` badge  2. Select image without EXIF with device GPS available → observe `Device GPS (Photo Time)` or `Device GPS`  3. Simulate no GPS → use manual entry |
| Test Data | Geo-tagged image; plain image; manual address text |
| Expected Result | Source badges show `Photo EXIF`, `Device GPS (Photo Time)` or `Device GPS` or `Manual Entry` accordingly; `location` and `location_address` are submitted to backend. |
| Actual Result |  |
| Pass/Fail |  |
| Evidence | Payload captured by proxy or backend logs; UI badges/screenshots |

---

## TC04 — Upload timeout recovery probe

| Field | Details |
|---|---|
| Test Case ID | TC04 |
| Test Case Name | Upload timeout recovery probe |
| Special Condition | Simulate backend timeout during upload (client-side timeout) |
| Test Scenario | After timeout, the frontend probes the My Submissions endpoint to detect likely successful uploads and warns user appropriately |
| Test Steps | 1. Start upload and simulate a network timeout  2. Observe frontend recovery behaviour |
| Test Data | Normal image; force an upload timeout (stub or network throttling) |
| Expected Result | Frontend calls the My Submissions endpoint with the existing token; if a recent nearby submission is found it shows a warning that the upload likely succeeded; otherwise it shows a retry error. |
| Actual Result |  |
| Pass/Fail |  |
| Evidence | Network trace; UI toast screenshot; My Submissions probe response |

---

## TC05 — Contact preference modal

| Field | Details |
|---|---|
| Test Case ID | TC05 |
| Test Case Name | Contact preference modal |
| Special Condition | First-time user or editing preference |
| Test Scenario | Save, skip, and validate email form behaviour |
| Test Steps | 1. Open Report UI  2. Open contact modal  3. Enter invalid email → save (expect validation)  4. Enter valid email → save  5. Verify contact stored |
| Test Data | Invalid email, valid email |
| Expected Result | Invalid email shows warning toast; valid email saves to LocalStorage with `optedIn:true` and email in JSON payload. Skipping stores optedIn:false. |
| Actual Result |  |
| Pass/Fail |  |
| Evidence | LocalStorage value; screenshots |

---

## TC06 — My Submissions: list rendering & detail modal

| Field | Details |
|---|---|
| Test Case ID | TC06 |
| Test Case Name | My Submissions: list & detail modal |
| Special Condition | User has multiple records |
| Test Scenario | Load list, open detail modal, verify displayed fields |
| Test Steps | 1. Open `My Submissions`  2. Confirm API call includes `token`  3. Click an item to open modal |
| Test Data | Multiple Firestore reports for token |
| Expected Result | List shows thumbnails, status badges, timestamps, hazard label and confidence; clicking item opens modal with image, record id, status, location text and description. |
| Actual Result |  |
| Pass/Fail |  |
| Evidence | API request/response; modal screenshot |

---

## TC07 — MapPanel: pins and popup content

| Field | Details |
|---|---|
| Test Case ID | TC07 |
| Test Case Name | MapPanel pins & popup |
| Special Condition | Firestore listener or reports endpoint fallback available |
| Test Scenario | Open map panel and inspect marker popups for visible statuses |
| Test Steps | 1. Open map (floating button)  2. Click pins for Verified/Requested/In Progress  3. Inspect popup content |
| Test Data | Reports with statuses and mediaURL/location |
| Expected Result | Pins shown for visible statuses; popup contains thumbnail, status badge, hazard label, location text and timestamp. Tile provider fallback and tile error UI exercised if tiles fail. |
| Actual Result |  |
| Pass/Fail |  |
| Evidence | Map screenshot; popup HTML; tile error messages (if any) |

---

## TC08 — Search & filter (Dashboard)

| Field | Details |
|---|---|
| Test Case ID | TC08 |
| Test Case Name | Search & filter (Dashboard) |
| Special Condition | Admin logged in; dataset contains multiple statuses/classes |
| Test Scenario | Apply type and location filters and switch tabs (All/Pending/Verified/Requested/...) |
| Test Steps | 1. Login as admin  2. Open Dashboard → Management  3. Apply filters and confirm list changes |
| Test Data | Reports with varied statuses and detection classes |
| Expected Result | Dashboard updates list count and selected items reflect filters; selected report remains visible where applicable. |
| Actual Result |  |
| Pass/Fail |  |
| Evidence | API requests; filtered UI screenshot |

---

## TC09 — Admin: login, auth guard, logout

| Field | Details |
|---|---|
| Test Case ID | TC09 |
| Test Case Name | Admin login / auth guard |
| Special Condition | Valid and invalid credentials available |
| Test Scenario | Authenticate, access dashboard, logout, and verify guard redirects to login when unauthenticated |
| Test Steps | 1. Attempt login with wrong creds → expect error  2. Login with valid creds → reach dashboard  3. Logout → verify redirected to login |
| Test Data | Admin credentials |
| Expected Result | Proper error on bad creds; successful navigation to dashboard on good creds; `auth/me` used to check session; logout revokes session and redirects. |
| Actual Result |  |
| Pass/Fail |  |
| Evidence | Network traces; screenshots of login / dashboard |

---

## TC10 — Admin: update status & contractor workflow

| Field | Details |
|---|---|
| Test Case ID | TC10 |
| Test Case Name | Admin update status & contractor workflow |
| Special Condition | Admin logged in; target record exists |
| Test Scenario | Change status, request repair, assign contractor and simulate partner actions |
| Test Steps | 1. Change status to Requested/In Progress/Completed  2. Use Contractor picker to simulate assignment  3. Use the repair simulator to accept/complete/reject |
| Test Data | `recordId`, contractor directory entries |
| Expected Result | Status updates immediately in UI; repair workflow updates persisted; simulated partner actions update record state and create repair events; notification metadata returned. |
| Actual Result |  |
| Pass/Fail |  |
| Evidence | API responses; updated report object; repair workflow/log entries |

---

## TC11 — Feedback / correction (Admin)

| Field | Details |
|---|---|
| Test Case ID | TC11 |
| Test Case Name | Feedback / correction (Admin) |
| Special Condition | Admin logged in; report with detections present |
| Test Scenario | Submit feedback to the backend/training side and verify model training queue impact |
| Test Steps | 1. Open report in dashboard  2. Submit correction (isCorrect false + corrected class)  3. Observe response and auto-retrain metadata |
| Test Data | `recordId`, corrected class, optional bbox/note |
| Expected Result | API responds with finalClass and optionally `autoRetrain` metadata; UI updates report.aiFeedback and finalHazardClass; pending feedback counters updated. When feedback reaches the configured minimum (default 10), the backend may queue an auto-retrain job and return `autoRetrain` metadata to the UI. |
| Actual Result |  |
| Pass/Fail |  |
| Evidence | API response; dashboard state; `autoRetrain` payload |

---

## TC12 — Duplicate detection (server-side)

| Field | Details |
|---|---|
| Test Case ID | TC12 |
| Test Case Name | Duplicate detection (server) |
| Special Condition | Identical image uploaded multiple times, or nearby coordinates within short time |
| Test Scenario | Ensure server deduplicates or links duplicates and frontend warns on timeout recovery |
| Test Steps | 1. Upload identical image A twice  2. Inspect Firestore `imageFingerprint` or linked record fields  3. Trigger upload timeout and observe probe behavior |
| Test Data | Two identical image binaries |
| Expected Result | The backend merges or links duplicates and records a fingerprint; the frontend uses the My Submissions probe to avoid retrying duplicate uploads after a timeout. |
| Actual Result |  |
| Pass/Fail |  |
| Evidence | Firestore entries; API responses; probe logs |

---

## TC13 — Notifications & email delivery

| Field | Details |
|---|---|
| Test Case ID | TC13 |
| Test Case Name | Notifications & email delivery |
| Special Condition | SMTP/third-party email configured in backend (or sandboxed test mode) |
| Test Scenario | Trigger user notification on status change and check delivery metadata |
| Test Steps | 1. Ensure user has opted in  2. Admin sets status to Completed  3. Inspect response for notification metadata and delivery flag |
| Test Data | `recordId` with contact saved |
| Expected Result | Backend attempts delivery and returns notification metadata with attempted/deliverySucceeded flags; email may require external setup. |
| Actual Result |  |
| Pass/Fail |  |
| Evidence | API response; email logs (if available) |

---

## TC14 — Augmentation & retrain triggers (Admin)

| Field | Details |
|---|---|
| Test Case ID | TC14 |
| Test Case Name | Augmentation & retrain triggers |
| Special Condition | Admin logged in; appropriate backend endpoints available |
| Test Scenario | Trigger the backend augmentation process and the retrain action, verify responses and retrain metadata |
| Test Steps | 1. Run augmentation with sample config  2. Trigger retrain action  3. Observe returned metadata and UI to reflect progress |
| Test Data | Augmentation config; admin session |
| Expected Result | Augmentation returns results or error with guidance; retrain returns state and may set cooldown or started flag; UI surfaces messages accordingly. |
| Actual Result |  |
| Pass/Fail |  |
| Evidence | API responses; dashboard messages |

---

## TC15 — Partner portal iframe load

| Field | Details |
|---|---|
| Test Case ID | TC15 |
| Test Case Name | Partner portal iframe load |
| Special Condition | `partnerToken` path present (partner repair page token) |
| Test Scenario | Load partner portal URL and ensure iframe src resolves to backend partner URL |
| Test Steps | 1. Open the partner portal page at the partner repair path  2. Confirm the iframe `src` resolves to the backend partner repair URL  3. Interact as partner (if sandbox) |
| Test Data | Partner token value |
| Expected Result | Iframe loads partner portal URL; missing token shows an error. Partner actions are proxied to backend. |
| Actual Result |  |
| Pass/Fail |  |
| Evidence | Iframe src value; portal screenshot |

---

## TC16 — Accessibility and responsiveness (smoke)

| Field | Details |
|---|---|
| Test Case ID | TC16 |
| Test Case Name | Accessibility & responsive smoke |
| Special Condition | Desktop, tablet, mobile viewports |
| Test Scenario | Verify main flows render and are operable across viewports and keyboard navigation |
| Test Steps | 1. Resize to mobile/tablet/desktop  2. Navigate to Report → Upload → My Submissions using keyboard/touch  3. Run quick axe or Lighthouse checks (optional) |
| Test Data | Different viewport sizes |
| Expected Result | Layout adapts; controls available via keyboard; no blocking accessibility failures. |
| Actual Result |  |
| Pass/Fail |  |
| Evidence | Screenshots; Lighthouse/axe results |

---

## TC17 — Performance smoke: upload latencies

| Field | Details |
|---|---|
| Test Case ID | TC17 |
| Test Case Name | Performance smoke |
| Special Condition | Backend available for test runs |
| Test Scenario | Measure upload roundtrip time under representative conditions |
| Test Steps | 1. Submit N uploads (N=10)  2. Record submit→ack times client-side  3. Compute median and p95 |
| Test Data | Representative images |
| Expected Result | Median/p95 reported; no repeated timeouts under normal conditions. |
| Actual Result |  |
| Pass/Fail |  |
| Evidence | CSV/timings logs |

---

## Appendix: Artifacts & Execution

- Store API tests in `tests/api/`, E2E scripts in `tests/e2e/`, and artifacts under `tests/artifacts/{TCID}/`.
- If you want I can generate Playwright skeletons for a chosen subset (e.g., TC01, TC04, TC06, TC09, TC10). Specify which ones to scaffold.
