-- Per-trigger trace-readiness debounce (ADR-026). Notify-class triggers route
-- through the outbox settle stage; this column is the TTL of the dedup window
-- that holds the trace before filters re-evaluate. A higher value absorbs more
-- late spans on slow agentic traces; a lower value reduces notification latency
-- when the trace is known to settle quickly. Persist-class actions dispatch
-- inline and ignore this column.
--
-- Default of 30000 (30s) matches `DEFAULT_TRACE_DEBOUNCE_MS` so existing
-- triggers keep the same behavior they had before this column existed.

-- AlterTable
ALTER TABLE "Trigger" ADD COLUMN "traceDebounceMs" INTEGER NOT NULL DEFAULT 30000;

-- To roll back, uncomment and run manually:
-- ALTER TABLE "Trigger" DROP COLUMN "traceDebounceMs";
