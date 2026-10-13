# Email Auto-Send Setup (Gmail SMTP)

This guide enables automatic sending of repair request emails from backend without opening a draft.

## 1) Prepare Gmail account

Use your dedicated mailbox:
- `roadhazard.contractor@gmail.com` (recipient)

Create a sender account (recommended separate):
- Example: `roadhazard.sender@gmail.com`

Why separate sender account:
- Better security and easier to rotate credentials.

## 2) Enable App Password on sender Gmail

1. Sign in to the sender Gmail account.
2. Turn on 2-Step Verification.
3. Go to Google Account -> Security -> App passwords.
4. Create app password (Mail).
5. Copy the 16-character password (no spaces).

## 3) Configure local env (for `start_all.ps1`)

Edit `start_all.ps1` and set these values in backend env block:

- `AUTO_REPAIR_EMAIL_ENABLED='true'`
- `SMTP_USERNAME='roadhazard.sender@gmail.com'`
- `SMTP_PASSWORD='eoyq trkx gsuz xfbv'`
- `SMTP_FROM='roadhazard.sender@gmail.com'`

Keep these as:
- `SMTP_HOST='smtp.gmail.com'`
- `SMTP_PORT='587'`
- `SMTP_USE_TLS='true'`

Then restart app:

```powershell
.\start_all.ps1
```

## 4) Configure hosted Cloud Run env

Option A: Quick (edit script)
- In `update_hosting.ps1`, set:
  - `AUTO_REPAIR_EMAIL_ENABLED=true`
  - `SMTP_USERNAME=roadhazard.sender@gmail.com`
  - `SMTP_PASSWORD=<YOUR_APP_PASSWORD>`
  - `SMTP_FROM=roadhazard.sender@gmail.com`

Deploy backend:

```powershell
.\update_hosting.ps1 -Target backend -ProjectId roadhazard-fyp
```

Option B: Recommended (set secrets via gcloud manually)

```powershell
gcloud run services update roadhazard-api `
  --region asia-southeast1 `
  --set-env-vars AUTO_REPAIR_EMAIL_ENABLED=true,SMTP_HOST=smtp.gmail.com,SMTP_PORT=587,SMTP_USE_TLS=true,SMTP_USERNAME=roadhazard.sender@gmail.com,SMTP_FROM=roadhazard.sender@gmail.com,DEFAULT_CONTRACTOR_EMAIL=roadhazard.contractor@gmail.com,SMTP_PASSWORD=<YOUR_APP_PASSWORD>
```

## 5) Verify it works

1. In dashboard, click `Send Repair Request`.
2. Expected result:
   - Status changes to `Requested`.
   - Toast says `Repair request auto-sent to ...`.
   - No Gmail draft popup needed.
3. Check recipient inbox (`roadhazard.contractor@gmail.com`).

If auto-send fails, frontend falls back to opening Gmail draft automatically.

## 6) Troubleshooting

- Error: `SMTP credentials are not configured`
  - Set `SMTP_USERNAME` and `SMTP_PASSWORD`.
- Error: `Username and Password not accepted`
  - Use App Password, not normal Gmail password.
- No inbox mail:
  - Check Spam folder.
  - Confirm sender account can send via SMTP.
- Still opening draft instead of auto-send:
  - `AUTO_REPAIR_EMAIL_ENABLED` is false, or backend not redeployed.

## 7) Security notes

- Never commit real app passwords to git.
- Prefer environment variables or secret manager for production.
- Rotate app password if exposed.
