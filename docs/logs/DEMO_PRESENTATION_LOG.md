# Demo Presentation Log and Flow (FYP_RoadHazard)

## 1) Purpose of This Document
This file is a presenter script for demo week. It explains:
- What each important and minor feature does.
- How each feature works (implementation logic).
- Why each feature was designed that way (engineering rationale).
- Keywords and pseudocode cues to support academic explanation.

Use this together with:
- `DEVELOPMENT_LOG.md`
- `ALGORITHM_REFERENCE.md`
- `PROJECT_STRUCTURE_GUIDE.md`

---

## 2) Demo Objective (What You Must Prove)
By the end of the demo, examiners should see evidence that the system is:
1. Functional end-to-end: report -> AI detect -> admin decision -> repair workflow.
2. Robust: can handle uncertainty, status transitions, and operational failures safely.
3. Practical: includes lifecycle controls (storage/cost/maintenance) and audit-friendly workflow events.
4. Academically reasoned: every design decision has clear "why", not only "it works".

## 2.1 Where the Database/Data Is Kept (And Why)
- Primary database: Firebase Firestore (cloud document database).
- Main purpose:
  - Store report records, status, workflow events, and feedback metadata.
  - Collections used in current flow include `hazard_records`, `training_feedback`, and retrain state under `system_state`.
- Image/file storage: Firebase Cloud Storage.
- Main purpose:
  - Store uploaded road images and media artifacts separately from database metadata.

Why this design is used:
- Firestore is good for app records that change often (status updates, workflow, feedback).
- Cloud Storage is better for large binary files (images), so database stays lightweight and fast.
- This separation (`metadata in Firestore`, `files in Storage`) is standard for scalable web systems.

Simple line for examiners:
- "We keep structured app data in Firestore and heavy image files in Cloud Storage to balance performance, cost, and maintainability."

## 2.2 Why Firebase Hosting + Google Cloud Run (And Purpose)
- Firebase Hosting purpose:
  - Serve the frontend (React build) quickly with HTTPS and CDN.
  - Give one public web domain for users.
- Cloud Run purpose:
  - Run Flask backend and YOLO inference as a containerized API service.
  - Scale compute for AI requests without managing a full VM server.

Why this combination is used:
- Frontend and backend have different workloads:
  - Frontend = static files (best on Hosting/CDN).
  - Backend AI = dynamic compute (best on Cloud Run container runtime).
- Firebase Hosting rewrites `/api/**` to Cloud Run, so users experience one website while backend stays separately scalable.
- This reduces CORS complexity and keeps deployment clean (`frontend deploy` and `api deploy` can be managed independently).

Simple line for examiners:
- "Firebase Hosting is optimized for fast static web delivery, while Cloud Run is optimized for scalable backend compute; together they give clean architecture and easier operations."

---

## 3) Recommended Demo Duration and Flow
Total recommended: 15-20 minutes.

### Part A: System Introduction (2 minutes)
- Show architecture slide:
  - Frontend: React + Vite
  - Backend: Flask
  - Data: Firestore + Cloud Storage
  - AI: YOLO multi-class
- Key message:
  - "This is an AI-assisted road hazard management pipeline, not only object detection."

### Part B: Live Citizen Report Submission (3 minutes)
- Open report page and upload an image.
- Show location capture (EXIF/GPS/manual fallback).
- Submit report and show AI result returned.

### Part C: Admin Review and Decision (3 minutes)
- Open dashboard and select new report.
- Explain detection class/confidence and status tabs.
- Move status from `Pending` -> `Verified`.
- Explain feedback/retrain integrity rule (only pending-to-verified should count).

### Part D: Repair Request Workflow (4 minutes)
- Click `Send Repair Request`.
- Show generated repair workflow details and partner link.
- Open partner portal link (accept/complete actions).
- Return to dashboard and show status/event updates + inbox notifications.

### Part E: Reliability and Safety Behaviors (3 minutes)
- Explain fail-closed email behavior:
  - If contractor email fails, status does not move to `Requested`.
- Explain rollback behavior:
  - `Requested/In Progress/Completed` -> `Verified` clears stale workflow.
- Show persistent error toast behavior (manual dismissal).

### Part F: Operations and Cost Control (2-3 minutes)
- Show maintenance toggles and cleanup policy scripts.
- Show retention strategy for storage + artifact cleanup policy.
- Explain this as production-readiness and sustainability evidence.

---

## 4) Major Features (What / How / Why / Keywords)

Line numbers below are pinned to the current project state for fast Q&A navigation.

## 4.1 Multi-Class Hazard Detection
- What:
  - Detect road hazards with class labels (pothole and crack-related classes).
- How:
  - Upload image -> backend inference -> normalized label output.
- Why:
  - Multi-class supports richer maintenance prioritization compared to binary detection.
- Keywords:
  - `YOLO`, `normalize_label`, `confidence`, `class remap`.
- Code references:
  - Upload endpoint: `webapp/app.py:2191`
  - Label normalization core: `webapp/app.py:519`
  - Hazard label canonicalization: `webapp/app.py:665`
  - Two-pass inference entry: `webapp/app.py:1234`

Pseudocode cue:
```text
input_image -> yolo_infer -> raw_detections
for each detection:
  class_name = normalize_label(raw_class, confidence)
store report + detections -> return api_response
```

Pseudocode-to-code anchors:
- `input_image -> yolo_infer`: `webapp/app.py:2191`, `webapp/app.py:1234`
- `normalize_label(raw_class, confidence)`: `webapp/app.py:519`
- `return api_response`: `webapp/app.py:2191`

## 4.2 Scenario Consensus Robustness
- What:
  - Improves decision confidence by evaluating multiple synthetic conditions.
- How:
  - Run inference over scenario variants (rain/shadow/glare/etc.), then weighted consensus.
- Why:
  - Single-image predictions can fluctuate under adverse road lighting/weather.
- Keywords:
  - `augmentation`, `consensus`, `weighted score`, `margin threshold`.
- Code references:
  - Scenario confidence orchestrator: `webapp/app.py:1320`
  - Consensus scorer: `webapp/app.py:696`
  - Scenario weight function: `webapp/app.py:688`
  - Augmentation operators:
    - `webapp/app.py:1035`
    - `webapp/app.py:1059`
    - `webapp/app.py:1115`
    - `webapp/app.py:1146`
    - `webapp/app.py:1189`
    - `webapp/app.py:1205`

Pseudocode cue:
```text
scenarios = augment(image, enabled_effects)
scores = {}
for scenario in scenarios:
  det = infer(scenario.image)
  scores += weight(scenario.name) * class_score(det)
final_class = argmax(scores)
if crack_subtype_uncertain: final_class = "crack"
```

Pseudocode-to-code anchors:
- `augment(image, enabled_effects)`: `webapp/app.py:1320`
- `scores += weight(...)`: `webapp/app.py:688`, `webapp/app.py:696`
- `if crack_subtype_uncertain`: `webapp/app.py:519`, `webapp/app.py:696`

## 4.3 Admin Verification and Controlled Retrain Signals
- What:
  - Admin validates reports and can correct AI outputs.
- How:
  - Status update endpoints + feedback dataset sample generation.
- Why:
  - Human-in-the-loop improves data quality and prevents noisy retrain labels.
- Keywords:
  - `human-in-the-loop`, `feedback_detection`, `bbox selection`, `dataset sample`.
- Code references:
  - Status update endpoint: `webapp/app.py:2510`
  - Feedback endpoint: `webapp/app.py:2776`
  - Feedback bbox selection: `webapp/app.py:826`
  - Feedback sample writer: `webapp/app.py:882`
  - Feedback capture gate (`Pending -> Verified`): `webapp/app.py:2557`

Pseudocode cue:
```text
if transition == Pending -> Verified:
  pending_feedback_count += 1
if correction_submitted:
  bbox = select_or_validate_bbox()
  write_yolo_feedback_sample(image, bbox, corrected_class)
```

Pseudocode-to-code anchors:
- `transition == Pending -> Verified`: `webapp/app.py:2557`
- `correction_submitted`: `webapp/app.py:2776`
- `select_or_validate_bbox()`: `webapp/app.py:826`
- `write_yolo_feedback_sample(...)`: `webapp/app.py:882`

## 4.4 Repair Request Lifecycle with Third-Party Portal
- What:
  - Replaces internal "start repair" simulation with request-based partner interaction.
- How:
  - Admin sends request -> tokenized partner link -> partner accepts/completes -> event log updates.
- Why:
  - Models real municipal flow where contractor action is external to admin dashboard.
- Keywords:
  - `Requested`, `partner token`, `workflow events`, `state machine`.
- Code references:
  - Status key normalization: `webapp/app.py:1964`
  - Workflow composer: `webapp/app.py:2013`
  - Portal URL helper: `webapp/app.py:1968`
  - Send request endpoint: `webapp/app.py:2581`
  - Partner portal endpoint: `webapp/app.py:2715`
  - Simulate endpoint: `webapp/app.py:2662`
  - Dashboard request handler: `frontend/src/components/Dashboard.jsx:534`
  - Management action button: `frontend/src/components/dashboard/ManagementPage.jsx:512`
  - Requested tab: `frontend/src/components/dashboard/ManagementPage.jsx:79`

Pseudocode cue:
```text
admin_click_send_request(report_id):
  token = generate_partner_token()
  workflow.events += "requested"
  send_email_with_link(token)
  if email_failed: abort_transition
  else status = Requested

partner_action(token, action):
  if action == accept: status = In Progress
  if action == complete: status = Completed
  append_workflow_event(action)
```

Pseudocode-to-code anchors:
- `generate_partner_token()` + `partnerPortalUrl`: `webapp/app.py:2013`, `webapp/app.py:2031`
- `send_email_with_link(token)`: `webapp/app.py:1983`, `webapp/app.py:2612`
- `if email_failed: abort_transition`: `webapp/app.py:2631`
- `status = Requested`: `webapp/app.py:2581`
- `partner_action(token, action)`: `webapp/app.py:2715`

## 4.5 Notification Inbox in Admin Header
- What:
  - Inbox-style notifications from workflow events with unread/read behavior.
- How:
  - Derive notifications from `repairWorkflow.events` and persist seen state locally.
- Why:
  - Centralized visibility improves operator response and reduces missed updates.
- Keywords:
  - `event stream`, `unread badge`, `mark all read`, `jump to report`.
- Code references:
  - Seen-event storage key: `frontend/src/components/Dashboard.jsx:24`
  - Seen IDs state: `frontend/src/components/Dashboard.jsx:113`
  - Notification derivation (`repairNotifications`): `frontend/src/components/Dashboard.jsx:620`
  - Unread count memo: `frontend/src/components/Dashboard.jsx:645`
  - Local storage persistence: `frontend/src/components/Dashboard.jsx:651`

---

## 5) Minor Features (Still Important in Evaluation)

## 5.1 Persistent Error Toasts
- What:
  - Error messages remain visible until manually closed.
- How:
  - Auto-dismiss timer disabled for `error` toast type only.
- Why:
  - Prevents silent failure confusion during operational troubleshooting.
- Code references:
  - Toast helper: `frontend/src/components/Dashboard.jsx:166`
  - Error no-auto-dismiss rule: `frontend/src/components/Dashboard.jsx:146`

## 5.2 Rollback Safety
- What:
  - Moving repair states back to `Verified` clears obsolete repair workflow UI state.
- How:
  - Backend returns explicit null workflow and frontend syncs local state accordingly.
- Why:
  - Avoids stale workflow artifacts and incorrect admin interpretation.
- Code references:
  - Previous/new status keys: `webapp/app.py:2535`, `webapp/app.py:2536`
  - Clear workflow on rollback: `webapp/app.py:2552`, `webapp/app.py:2553`
  - Return explicit null workflow: `webapp/app.py:2565`
  - Frontend null-workflow sync: `frontend/src/components/Dashboard.jsx:503`, `frontend/src/components/Dashboard.jsx:504`

## 5.3 Storage and Cost Governance
- What:
  - Scripted cleanup and lifecycle policy for old media.
- How:
  - `cleanup_hazards_storage.py` + `storage.lifecycle.json`.
- Why:
  - Keeps cloud resources sustainable and avoids quota incidents.
- Code references:
  - CLI entrypoint: `cleanup_hazards_storage.py:90`
  - Age-based flag: `cleanup_hazards_storage.py:92`
  - Keep-latest flag: `cleanup_hazards_storage.py:94`
  - Firestore cleanup option: `cleanup_hazards_storage.py:159`
  - Ops commands guide: `OPERATIONS_COMMANDS.md:85`
  - Lifecycle policy command: `OPERATIONS_COMMANDS.md:106`

## 5.4 Cloud Run Public Toggle / Maintenance Mode
- What:
  - Operational ability to expose/hide public API quickly.
- How:
  - `toggle_cloud_run_public.ps1`, `maintenance_mode.ps1`.
- Why:
  - Supports low-cost idle periods and controlled live-demo activation.
- Code references:
  - Toggle script usage: `OPERATIONS_COMMANDS.md:7`
  - Maintenance script usage: `OPERATIONS_COMMANDS.md:29`
  - Routine ON/OFF sequence: `OPERATIONS_COMMANDS.md:113`

## 5.5 Report Location Fallback (EXIF -> GPS -> Manual)
- What:
  - Location capture prioritizes metadata and device sensor, then manual geocoding as fallback.
- How:
  - EXIF extraction first, geolocation watch second, Nominatim manual conversion third.
- Why:
  - Preserves speed and accuracy while guaranteeing completion when automatic capture fails.
- Keywords:
  - `EXIF`, `watchPosition`, `manual fallback`, `Nominatim`.
- Code references:
  - EXIF extractor: `frontend/src/components/Report.jsx:60`
  - GPS capture flow: `frontend/src/components/Report.jsx:121`
  - `watchPosition` call: `frontend/src/components/Report.jsx:208`
  - Manual geocode: `frontend/src/components/Report.jsx:216`, `frontend/src/components/Report.jsx:221`
  - Manual submit handler: `frontend/src/components/Report.jsx:250`
  - File-change orchestrator: `frontend/src/components/Report.jsx:316`

---

## 6) End-to-End Demo Narrative (Speaker Script)
Use this sentence flow during presentation.

1. "I begin from citizen reporting. The system captures image and location, then performs AI hazard detection."
2. "This report enters a managed state machine, starting from `Pending`."
3. "Admin reviews and verifies only valid hazards; this protects retraining data quality."
4. "After verification, repair is requested through a partner-link workflow, not a fake local-only button."
5. "Contractor actions update the report lifecycle (`Requested -> In Progress -> Completed`) and generate inbox notifications."
6. "If email delivery fails, we fail closed: report status does not transition, preserving operational integrity."
7. "For sustainability, storage retention and artifact cleanup policies are included, with maintenance toggles for cloud cost control."

---

## 7) Demo Checklist (Before Presenting)

## 7.1 Technical Checklist
- Run app stack and verify both frontend/backend are reachable.
- Ensure at least 3 prepared sample images:
  - clear pothole,
  - crack subtype,
  - challenging condition image.
- Verify one report in each status for fast tab demonstration.
- Confirm SMTP config works for repair request demo (or prepare fallback explanation).

## 7.2 Storytelling Checklist
- Always explain each feature as:
  - Problem -> Design -> Implementation -> Outcome.
- Keep equations minimal; prefer flow + pseudocode + evidence.
- Mention trade-offs explicitly (speed vs robustness, automation vs safety).

---

## 8) Backup Plan (If Live Demo Fails)
If internet/SMTP/cloud is unstable:
1. Demo on local environment (`start_all.ps1`).
2. Use partner simulation endpoint flow and existing records.
3. Show saved screenshots/logs for hosted outage scenarios and explain safeguards.
4. Emphasize architecture and verified code paths rather than only runtime output.

---

## 9) Likely Examiner Questions and Strong Answers

1. Question: "Why add `Requested` status?"
Answer: "It separates verification from external execution, representing real contractor handoff and improving process traceability."

2. Question: "How do you ensure retrain data quality?"
Answer: "We gate feedback counting to valid transition rules and use bbox-targeted correction samples to avoid noisy labels."

3. Question: "What happens if email fails?"
Answer: "Fail-closed design prevents false progression to requested state, so operational dashboard remains truthful."

4. Question: "How is this production-conscious?"
Answer: "We included retention/lifecycle policies, maintenance toggles, and cleanup automation to control quota/cost and keep uptime predictable."

---

## 10) Keywords to Mention Repeatedly (Academic Signals)
- `state machine`
- `human-in-the-loop`
- `fail-closed`
- `data integrity`
- `operational sustainability`
- `consensus robustness`
- `traceability`
- `deployment parity`
- `lifecycle governance`

---

## 11) UI/UX Polish and Runtime Robustness (April 2026)

### **Key Improvements for Demo Readiness**

#### **A) Visual Professionalism and Dark Mode**
**Why it matters:**
- First impressions matter in demos. A polished UI signals engineering maturity.
- Dark mode is easier on eyes during long demo sessions.

**What was done:**
- Removed emoji-heavy labels (previous: "🔧 Pending Verify", now: "Pending Verification").
- Applied global theme tokens for borders, backgrounds, and text colors.
- Softened bright white outlines in dark mode to `rgba(148, 163, 184, 0.24)`.
- Added hover-reactive states to tabs and buttons for visual feedback.

**Code locations:**
- `frontend/src/index.css` (global theme tokens)
- `frontend/src/App.css` (dark mode overrides)
- `frontend/src/components/dashboard/ManagementPage.jsx` (tab styling)

**Demo talking points:**
- "The dashboard now adapts to light and dark modes without harsh visual artifacts."
- "Subtle hover feedback gives users confidence that controls are responsive."

#### **B) Runtime Crash Prevention**
**Why it matters:**
- Nothing kills a demo faster than a white-screen crash. Robustness is critical.
- Error boundaries allow graceful fallback instead of complete system failure.

**What was done:**
1. Added `AppErrorBoundary` in `App.jsx` that catches runtime exceptions:
   - Displays user-friendly error message.
   - Provides reload button for recovery.
   
2. Added safe helper functions in `ManagementPage.jsx`:
   - `formatCoordinates()` handles null, string, and object location data.
   - Guards against type mismatches and missing properties.

3. Added report payload normalization in `Dashboard.jsx`:
   - Sanitizes detections array at fetch time.
   - Provides safe fallbacks for missing fields.
   - Prevents malformed backend data from crashing component renders.

**Code locations:**
- `frontend/src/App.jsx` (error boundary)
- `frontend/src/components/Dashboard.jsx` (payload normalization)
- `frontend/src/components/dashboard/ManagementPage.jsx` (formatCoordinates, safe parsing)

**Demo talking points:**
- "Even if backend data is malformed, the app displays a recoverable error instead of crashing."
- "We validate and normalize all incoming data before rendering to ensure stability."

#### **C) Layout Stability and Scrolling**
**Why it matters:**
- Layout shifts and unexpected scrolling break the demo flow and look unprofessional.

**What was done:**
1. Bounded hazard management panel height to `clamp(520px, calc(100vh - 170px), 920px)`.
2. Constrained report list to scroll internally instead of stretching the page.
3. Applied fixed-height containers with `overflow-y: auto` to prevent layout overflow.

**Code locations:**
- `frontend/src/components/dashboard/ManagementPage.jsx` (container styling)

**Demo talking points:**
- "The page maintains a stable layout regardless of report count. Users can scroll reports without scrolling the entire page."

#### **D) Component State Independence**
**Why it matters:**
- Shared state bugs make the system look unreliable. Independent state = predictable behavior.

**What was done:**
- Contractor assignment cards now use stable `assignmentKey` instead of email-based indexing.
- Each card stores its own expansion state and request list lookup.
- Prevents cross-linking where changing one card affects another.

**Code locations:**
- `frontend/src/components/dashboard/ContractorsPage.jsx` (assignment key-based state)

**Demo talking points:**
- "Each contractor row maintains independent state. Opening one contractor's dropdown doesn't affect others."

#### **E) Mobile Responsiveness Groundwork**
**Why it matters:**
- Modern systems must work on mobile. This future-proofs the demo environment.

**What was done:**
- Added `isMobileView` detection in `Dashboard.jsx` based on viewport width.
- Passed responsive hints to child components for targeted sizing.
- Tab buttons scale down on mobile: `padding: '8px 12px'` vs desktop `'10px 16px'`.
- Management panel adapts overflow behavior based on screen size.

**Code locations:**
- `frontend/src/components/Dashboard.jsx` (isMobileView detection)
- `frontend/src/components/dashboard/ManagementPage.jsx` (responsive sizing)

**Demo talking points:**
- "The dashboard is designed to work on mobile/tablet viewports without breaking the desktop experience."
- "We use responsive CSS properties like `clamp()` to adapt layouts fluidly across screen sizes."

### **Testing and Validation During Demo**
- ✅ Verify error boundary by checking console for logged errors (they won't crash the app).
- ✅ Toggle dark mode to show theme consistency.
- ✅ Scroll through reports in management panel to confirm internal scrolling works.
- ✅ Click multiple contractor cards to show independent state.
- ✅ Mention that frontend build passes with no errors: `npm run build`.

---

## 12) File Map for Quick Reference During Q&A
- Main implementation: `webapp/app.py:1`
- Upload API and detection: `webapp/app.py:2191`
- Status workflow logic: `webapp/app.py:2510`
- Repair request workflow: `webapp/app.py:2581`
- Partner portal actions: `webapp/app.py:2715`
- Feedback correction endpoint: `webapp/app.py:2776`
- Admin flow/UI: `frontend/src/components/Dashboard.jsx:1`
- Management panels: `frontend/src/components/dashboard/ManagementPage.jsx:1`
- Report upload flow: `frontend/src/components/Report.jsx:1`
- Error boundary and app shell: `frontend/src/App.jsx:1`
- Global theme tokens: `frontend/src/index.css:1`
- Algorithms summary: `ALGORITHM_REFERENCE.md`
- Engineering chronology: `DEVELOPMENT_LOG.md`
- Ops controls: `OPERATIONS_COMMANDS.md`

---

## 13) Recent Additions Since the Original Demo Notes
- Hazard map entry point was added on the home page with a Leaflet-based panel for verified, requested, and in-progress hazards.
- Hosted dataset ZIP export was simplified to a direct file download path, and archive counts now prefer the complete Cloud Storage source when local artifacts are partial.
- Retrain controls were adjusted so the dashboard remains usable even when status polling is stale.
- Cloud Run was switched to instance-based billing with `min-instances=1` so the backend stays warm for more consistent API response times.
- The demo can now mention that the system is not only report/review oriented, but also includes operational controls for retrieval, retrain readiness, and live map visibility.

---

Prepared for: Demo Presentation Week
Project: FYP_RoadHazard
Last Updated: May 7, 2026
