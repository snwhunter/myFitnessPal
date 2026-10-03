# Workout UI flow

## User dashboard
The user URL opens a dashboard with metrics above the session list. The date roller starts centered on today, offers previous/next and Today controls, and allows a direct date selection. Each date has two independent sessions for Andrew. Opening a session displays its checklist.

## Default workout view
Each scheduled workout session is shown as a checklist. Every row contains:
- completion checkbox
- activity title
- thumbnail

Completing a row updates only the current session.

## Activity detail view
Expanding an activity shows:
- instructions / steps
- prescription details such as sets, reps, or hold time
- one or more detail images
- optional notes

## Scheduling and logging
A user workout creates independent workout sessions from its schedule.
Andrew's ankle rehab is daily with two sessions per day. Exact clock times remain configurable.

The current app saves each activity checkbox locally by user, workout, date and session. Session completion is derived from the checkboxes; the two sessions do not share state. Start/completion timestamps and centralized logging are part of the planned Google Sheets backend, and are not yet written by this local prototype.

## Google Sheets mapping
The backing tabs are defined in `docs/google-sheet-schema.json`:
- activity_templates
- workout_templates
- user_workouts
- workout_sessions
- exercise_logs

