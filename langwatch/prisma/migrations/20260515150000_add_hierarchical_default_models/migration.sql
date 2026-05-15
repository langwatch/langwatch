-- Add per-scope `defaultModel`, `topicClusteringModel`, and `embeddingsModel`
-- columns to Team and Organization so LangWatch features can resolve a default
-- model walking project → team → org → constant fallback. Projects already
-- carry these fields. Each column is nullable: a null value means "inherit
-- from the next level up". See langwatch/src/utils/modelProviderHelpers.ts.

ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "defaultModel" TEXT;
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "topicClusteringModel" TEXT;
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "embeddingsModel" TEXT;

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "defaultModel" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "topicClusteringModel" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "embeddingsModel" TEXT;
