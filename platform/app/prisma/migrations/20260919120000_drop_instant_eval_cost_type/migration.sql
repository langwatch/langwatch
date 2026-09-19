-- Drop the INSTANT_EVAL values from "CostType" and "CostReferenceType".
--
-- Instant Evals report spend through the gateway spend spine, so nothing
-- writes a Cost row for them any more. The values added by
-- 20260918120000_instant_eval_cost_type are dead, and PostgreSQL cannot remove
-- a value from an enum in place, so both types are recreated without it and
-- the two columns are moved across.
--
-- Any Cost row still carrying the value comes from the short-lived path that
-- wrote it and is deleted: it duplicates a spend record the gateway spine
-- already holds, and there is no other value it could mean.
--
-- To roll back, uncomment the reverse section and run it manually.

BEGIN;

DELETE FROM "Cost"
WHERE "costType"::text = 'INSTANT_EVAL'
   OR "referenceType"::text = 'INSTANT_EVAL';

ALTER TYPE "CostType" RENAME TO "CostType_v1";
CREATE TYPE "CostType" AS ENUM ('TRACE_CHECK', 'GUARDRAIL', 'CLUSTERING', 'BATCH_EVALUATION');
ALTER TABLE "Cost"
  ALTER COLUMN "costType" TYPE "CostType"
    USING ("costType"::text::"CostType");
DROP TYPE "CostType_v1";

ALTER TYPE "CostReferenceType" RENAME TO "CostReferenceType_v1";
CREATE TYPE "CostReferenceType" AS ENUM ('CHECK', 'TRACE', 'PROJECT', 'BATCH');
ALTER TABLE "Cost"
  ALTER COLUMN "referenceType" TYPE "CostReferenceType"
    USING ("referenceType"::text::"CostReferenceType");
DROP TYPE "CostReferenceType_v1";

COMMIT;

-- Down migration (commented, Prisma migrations are append-only in CI, manual
-- only, and the deleted rows do not come back):
--
-- BEGIN;
-- ALTER TYPE "CostType" ADD VALUE IF NOT EXISTS 'INSTANT_EVAL';
-- ALTER TYPE "CostReferenceType" ADD VALUE IF NOT EXISTS 'INSTANT_EVAL';
-- COMMIT;
