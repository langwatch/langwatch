-- Per-trigger notification cadence for digest batching of notify actions
-- (SEND_EMAIL, SEND_SLACK_MESSAGE). Persist actions (ADD_TO_DATASET,
-- ADD_TO_ANNOTATION_QUEUE) always dispatch immediately and ignore this column.
--
-- See dev/docs/adr/026-per-trigger-dispatch-timing.md.
--
-- Default is 'immediate' so every existing trigger keeps firing without a
-- digest delay. The app-layer default for *new* notify triggers is
-- '5min_digest' — that policy lives in code, not in the schema default, so
-- existing rows are not surprised by a behavior change.

-- AlterTable
ALTER TABLE "Trigger" ADD COLUMN "notificationCadence" TEXT NOT NULL DEFAULT 'immediate';

-- To roll back, uncomment and run manually:
-- ALTER TABLE "Trigger" DROP COLUMN "notificationCadence";
