-- IRREVERSIBLE: there is no down step. The columns are additive and hold
-- the scenario kind and red team configuration; a rollback leaves them in place for the previous release to ignore.
ALTER TABLE "Scenario" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'standard', ADD COLUMN IF NOT EXISTS "redTeam" JSONB;
