-- IRREVERSIBLE: there is no down step. The columns are additive and hold
-- the scenario kind, its red team configuration and the template that created it; a rollback leaves them in place for the previous release to ignore.
ALTER TABLE "Scenario" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'standard', ADD COLUMN IF NOT EXISTS "redTeam" JSONB, ADD COLUMN IF NOT EXISTS "sourceTemplateId" TEXT;
