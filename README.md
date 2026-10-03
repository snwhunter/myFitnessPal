# myFitnessPal

Andrew's dashboard: https://snwhunter.github.io/myFitnessPal/?user=andrew.hunter

The dashboard shows today's session and exercise totals, completed sessions over the past seven days, and a horizontal date selector initially centered on today. Select either daily session to open its exercise checklist; expand a row to see source instructions, prescription and exercise images.

Andrew's seven ankle rehabilitation activities are transcribed from the three supplied exercise sheets in `data/andrew-ankle-rehab.json`. Assets include exercise-only crops; patient headers and surrounding paperwork are excluded. The alphabet sheet has directions rather than an illustration. Its detail image preserves those directions.

Completion is stored in the browser independently by user, workout, local calendar date and session. Legacy undated progress is carried forward once to the day the updated app is first opened; the old data is retained. The app remains usable with temporary in-memory progress when device storage is unavailable. No cross-device synchronization or live Google Sheets connection is implemented yet; the intended tab layout remains in `docs/google-sheet-schema.json`.

Existing session links work with `?user=andrew.hunter&date=2026-10-03&session=1`. Omit `date` to use the device's current local date, and omit `session` to open the dashboard. Unknown users see a user-selection prompt.

For local development, serve this directory with `python3 -m http.server 8765`. Run state and data checks with `TZ=America/Los_Angeles node --test tests/*.test.mjs`. Pushes to `main` trigger the GitHub Pages workflow.
