-- The most recent evaluation of one alert.
--
-- The graph-alert evaluator already computes the observed value, the threshold
-- it compared against, and the verdict on every check — and records none of it
-- anywhere a customer can read. "Why is my alert not firing?" therefore had no
-- answer in the product.
--
-- Exactly one row per trigger: `triggerId` is the primary key and the write is
-- an upsert, so this is a bounded snapshot rather than a log. There is nothing
-- to retain or prune, and the rows disappear with their trigger.
--
-- Kept out of "TriggerSent" on purpose: that table is the FIRE ledger, guarded
-- by the "openIncidentKey" claim and counted by every "last fired" / "fires in
-- the last 30 days" / "currently firing" read. Non-fire evaluations written
-- there would silently change all of those answers.

-- CreateTable
CREATE TABLE "TriggerLatestEvaluation" (
    "triggerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMPTZ(3) NOT NULL,
    "verdict" TEXT NOT NULL,
    "observedValue" DOUBLE PRECISION,
    "threshold" DOUBLE PRECISION,
    "operator" TEXT,
    "timePeriodMinutes" INTEGER,
    "skipCode" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TriggerLatestEvaluation_pkey" PRIMARY KEY ("triggerId")
);

-- CreateIndex
CREATE INDEX "TriggerLatestEvaluation_projectId_idx" ON "TriggerLatestEvaluation"("projectId");

-- AddForeignKey
ALTER TABLE "TriggerLatestEvaluation" ADD CONSTRAINT "TriggerLatestEvaluation_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "Trigger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Down (manual): reverses this migration; run only to roll back.
--   DROP TABLE "TriggerLatestEvaluation";
