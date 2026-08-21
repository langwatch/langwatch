-- Dead-letter recovery (specs/ops/dead-letter-recovery.feature): an operator
-- can mark a dead outbox message as never-to-be-sent, and every failed
-- delivery attempt is recorded so the reason a message died is on the page
-- rather than only on a span.

-- 'discarded' is a mark, not a delete: the row is retained as its own audit
-- trail. The dispatcher's claim query filters status = 'pending', so it never
-- sees the new value.
ALTER TYPE "ProcessManagerOutboxStatus" ADD VALUE 'discarded';

CREATE TYPE "ProcessManagerOutboxAttemptOutcome" AS ENUM ('retry_scheduled', 'dead');

-- One row per FAILED attempt; successes write nothing, so the table grows
-- with trouble, not with traffic. ON DELETE CASCADE is the retention story:
-- attempt rows die with their message under the existing retention sweep.
CREATE TABLE "ProcessManagerOutboxAttempt" (
    "id" TEXT NOT NULL,
    "outboxId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "outcome" "ProcessManagerOutboxAttemptOutcome" NOT NULL,
    "errorType" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "retryAfterMs" INTEGER,

    CONSTRAINT "ProcessManagerOutboxAttempt_pkey" PRIMARY KEY ("id")
);

-- Also what makes the cascade delete affordable: Postgres does not index the
-- referencing side of a foreign key on its own.
CREATE INDEX "ProcessManagerOutboxAttempt_outboxId_attempt_idx"
    ON "ProcessManagerOutboxAttempt"("outboxId", "attempt");

ALTER TABLE "ProcessManagerOutboxAttempt"
    ADD CONSTRAINT "ProcessManagerOutboxAttempt_outboxId_fkey"
    FOREIGN KEY ("outboxId") REFERENCES "ProcessManagerOutbox"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- IRREVERSIBLE: the enum change cannot be undone. PostgreSQL has no
-- `ALTER TYPE ... DROP VALUE`, so reverting `discarded` means recreating the
-- type and rewriting every column that uses it, on the highest-volume table
-- in the system. Treat this migration as forward-only.
--
-- The table below IS droppable. To roll it back, uncomment and run manually;
-- doing so discards the recorded failure history.
-- DROP TABLE "ProcessManagerOutboxAttempt";
-- DROP TYPE "ProcessManagerOutboxAttemptOutcome";
