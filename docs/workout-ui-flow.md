# Workout UI flow

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

Each session stores its own start, completion, and status. Each activity completion is logged separately so session 1 and session 2 do not share state.

## Google Sheets mapping
The backing tabs are defined in `docs/google-sheet-schema.json`:
- activity_templates
- workout_templates
- user_workouts
- workout_sessions
- exercise_logs
