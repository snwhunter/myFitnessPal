# myFitnessPal Apps Script backend v0.3.3

`Code.gs` is the complete replacement for the script bound to the existing myFitnessPal Backend spreadsheet. GitHub Pages deploys the frontend only; committing this file does not deploy Apps Script.

## Install

1. In the existing spreadsheet, open Extensions → Apps Script.
2. Replace the contents of Code.gs with this file and save.
3. Open Deploy → Manage deployments, edit the existing web app, select New version, and deploy. Keep Execute as Me and access Anyone. Editing the existing deployment preserves its `/exec` URL.
4. Reload the frontend. The footer should show v0.3.3 and Backend: 0.3.3 once the updated endpoint responds. `?action=health` also returns backend_version.

## Changes

- Request-scoped table caches replace repeated spreadsheet reads during exercise/session enrichment. Each new request starts fresh; writes invalidate changed tables.
- All POST actions use a script lock and flush before release. Creation accepts session_number, reuses an existing slot, and enforces the template's times_per_day (default two). The frontend supplies the slot. Legacy clients without a slot stop creating new sessions after the daily limit.
- Session items are appended in one batch. Adjacent cell updates are batched without changing untouched values or formulas.
- Blank rows retain their physical row numbers for updates.
- `sessions&summary=true` returns progress/items without exercise enrichment; the existing full response remains the default. Dashboard response details are preserved.
- API events continue to append to Logs and include backend_version plus per-table read counts. Actual state remains in its existing domain tables.

Existing extra sessions are preserved. No cleanup or migration runs automatically. A live latency improvement can only be measured after deploying the updated Apps Script.

Validation: `TZ=America/Los_Angeles node --test tests/*.test.mjs` includes backend tests using mocked spreadsheet and lock services. The GitHub Pages workflow also runs mocked browser tests; it never writes to the live Google backend.
