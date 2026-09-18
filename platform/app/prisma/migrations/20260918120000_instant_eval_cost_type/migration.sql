-- Instant Evals record what one judged query cost, so the cost table needs a
-- type and a reference type for it.
--
-- IRREVERSIBLE: PostgreSQL cannot remove a value from an enum type. Undoing
-- this would mean recreating "CostType" and "CostReferenceType" and rewriting
-- every column that uses them, which is not safe against live data.
-- Forward-only by design, and harmless to leave in place: an added value is
-- inert on any build that does not emit it.
ALTER TYPE "CostType" ADD VALUE IF NOT EXISTS 'INSTANT_EVAL';
ALTER TYPE "CostReferenceType" ADD VALUE IF NOT EXISTS 'INSTANT_EVAL';
