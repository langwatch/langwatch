-- Retry bookkeeping for the report scheduler. A handler failure used to lose
-- the slot because the claim advanced `nextRunAt` before the handler ran.
-- `attempts` bounds the retries and `lastError` keeps the failure observable.
ALTER TABLE "ScheduledJob" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ScheduledJob" ADD COLUMN "lastError" TEXT;
