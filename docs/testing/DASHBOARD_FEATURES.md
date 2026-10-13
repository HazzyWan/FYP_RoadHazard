# Dashboard Features & Functions — UAT Focus

Purpose
- Provide a concise, user-focused inventory of the web app dashboard features and functions for User Acceptance Testing (UAT).
- Emphasize user-friendliness, interface accessibility, and data visibility for three audiences: general citizens, municipal inspectors, and external maintenance contractors.

Audience
- Citizens (public reporters)
- Municipal inspectors / admin users
- External maintenance contractors / partners

Dashboard Overview (what users see)
- Global summary: counts by status (Pending, Requested, In Progress, Verified, Completed)
- Recent activity feed: latest reports, status changes, and feedback
- MapPanel: interactive map with pins, filters and popups
- My Submissions: user-scoped list of reports submitted by the session `token`
- Detail view modal / page: photo, status, timestamps, location, description, and feedback history
- Notifications area: in-app messages about status changes and delivery attempts

Core Features & Functions
- Report intake preview
  - Show newly submitted reports and their current AI labels and confidence scores
  - Quick access to detail view and media
- Filtering & search
  - Filter by type, status, date, area, and keyword
  - Free-text search for record id, address, or notes
- Map interactions
  - Zoom/pan, cluster pins at high density
  - Pin popup: thumbnail, short status, label and quick-action links
  - Tile fallback and loading/error states
- Detail view
  - Large image viewer, EXIF/source badge (Photo EXIF / Device GPS / Manual), location text and map link
  - Detection boxes/labels overlay (admin view) or compact label list (public view)
  - Feedback history and admin corrections list
- My Submissions (public)
  - Shows report thumbnails, status badges, and submission time
  - Ability to view details and copy/share report link
- Admin actions & workflows
  - Status update controls (Requested, In Progress, Completed, Verified)
  - Contractor assignment / select contractor from directory
  - Repair simulator for partner workflow testing
  - Batch actions (bulk status changes, export selection)
- Feedback & correction
  - Submit correction for AI label or bbox (admin only)
  - Store feedback to training queue / backend/training side
  - Display auto-retrain metadata where available
- Augmentation & retrain controls (admin)
  - Trigger augmentation and retrain actions; show state and cooldown info
  - Auto-retrain on feedback: the system will auto-trigger retraining when a minimum number of feedback items are queued (default: 10). This is controlled by environment variables in [cloudrun.env](cloudrun.env#L36) (`AUTO_RETRAIN_MIN_FEEDBACK`) and the app config in [webapp/app.py](webapp/app.py#L277-L278). The UI surfaces retrain job metadata (epochs, batch size) and status when retraining runs.
- Notifications & Email
  - Send reporter/observer notifications on status change (opt-in)
  - Show delivery metadata in audit view

Partner / Contractor Features
- Partner iframe portal: load partner repair page inside the app
- Partner actions reflected back in the dashboard (assign/accept/complete)
- Contractor directory and assignment controls

Data & Audit Visibility
- Per-report metadata: record id, token, image fingerprint, AI confidence, final class, reporter contact (if saved)
- Audit trail: status changes, assigned contractor, partner actions, notifications attempts
- Export & reporting: CSV/JSON export of filtered lists

Accessibility & UX considerations (UAT focus)
- Keyboard navigation: tab order, focus ring visible, modal trapping
- Screen reader labels for key controls and map controls
- Contrast and color usage for status badges and important buttons
- Responsive layout: mobile, tablet, desktop

UAT Acceptance Criteria (high level)
- Usability: users complete the primary workflows (submit report, view My Submissions, view detail, submit feedback) without confusion in <= 3 steps.
- Discoverability: core actions (filter, search, update status, assign contractor) are obvious and accessible within the dashboard UI.
- Data visibility: report metadata and audit trail are visible where expected and match backend responses.
- Robustness: map and list gracefully handle no-data cases, slow network, and tile/provider failures.
- Accessibility: app meets basic keyboard and screen-reader checks for primary flows.

UAT Test Scenarios (examples to run)
- TC-UI-01: Submit a report and confirm the success screen, token saved, and entry appears in My Submissions.
- TC-UI-02: Open My Submissions, filter by status, and open a detail view; verify image, status and location are shown.
- TC-UI-03: Admin updates status → observe immediate UI update and notification entry.
- TC-UI-04: Assign a contractor and simulate partner accept/complete via the partner portal; verify dashboard state updates.
- TC-UI-05: Submit feedback/correction in admin → verify UI confirmation and training queue metadata displays.
- TC-UI-06: Test upload timeout recovery: force an upload timeout and run the My Submissions probe to detect likely success.
- TC-UI-07: Accessibility smoke: keyboard navigation through Report → My Submissions → Detail and perform one action.

Evidence to capture during UAT
- Screenshots and short screencasts of each flow
- Network traces or API response snippets for key actions (upload, status change, feedback)
- LocalStorage snapshot showing `roadhazard_reporter_token` where relevant
- CSV/JSON export of filtered lists used in tests

Recommended Next Steps
- Review this document and mark any missing dashboard features from your perspective.
- Optionally map these UAT scenarios to automated Playwright tests (I can scaffold examples if you'd like).

---
Created for UAT by the project team — adjust as needed for scope and audience.
