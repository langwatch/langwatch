-- When a project's legacy apiKey last authenticated a request; nullable, written by the
-- api-key module through the project module. Spec: modules/api-key/specs/request-credential-type.feature
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "legacyApiKeyLastUsedAt" TIMESTAMP(3);
