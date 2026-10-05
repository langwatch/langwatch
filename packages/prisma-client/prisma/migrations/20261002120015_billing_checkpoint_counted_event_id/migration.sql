-- Expand only. The newest usage month_counted event id a billing meter checkpoint applied,
-- so a stale or redelivered count is ignored. Nullable: existing rows have applied none,
-- and the previous image never names the column.
ALTER TABLE "BillingMeterCheckpoint" ADD COLUMN "lastCountedEventId" TEXT;
