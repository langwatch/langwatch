-- Converge the legacy per-organization / per-project privacy controls into the
-- unified scoped DataPrivacyPolicy, then drop those columns so the policy is the
-- single source of truth (no lingering field that a later edit could desync).
--
-- A control already at its default produces no rule: the resolver then returns
-- the platform default for that scope, which equals the old behaviour. An
-- explicit policy row that already exists for a scope wins (ON CONFLICT DO
-- NOTHING), so a rule set through the new UI is never clobbered by the backfill.
--
-- Irreversible: the legacy values live on as DataPrivacyPolicy rows after this
-- runs. There is no down migration (dropping the new rows would lose the posture).

-- Organization.governanceLogContentMode -> ORGANIZATION drop rule.
INSERT INTO "DataPrivacyPolicy" ("id", "organizationId", "scopeType", "scopeId", "personalOnly", "config", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  o."id",
  'ORGANIZATION',
  o."id",
  false,
  CASE o."governanceLogContentMode"
    WHEN 'strip_io' THEN '{"categories":{"input":{"disposition":"drop"},"output":{"disposition":"drop"},"system":{"disposition":"drop"}}}'::jsonb
    WHEN 'strip_all' THEN '{"categories":{"input":{"disposition":"drop"},"output":{"disposition":"drop"},"system":{"disposition":"drop"},"tools":{"disposition":"drop"}}}'::jsonb
  END,
  now(),
  now()
FROM "Organization" o
WHERE o."governanceLogContentMode" IN ('strip_io', 'strip_all')
ON CONFLICT ("scopeType", "scopeId", "personalOnly") DO NOTHING;

-- Project.capturedInput/OutputVisibility + piiRedactionLevel -> PROJECT rule.
-- VISIBLE_TO_ADMIN -> restrict to admins; REDACTED_TO_ALL -> restrict to no one;
-- STRICT/DISABLED -> the matching PII level. Defaults (VISIBLE_TO_ALL, ESSENTIAL)
-- contribute nothing.
WITH project_legacy AS (
  SELECT
    p."id" AS project_id,
    t."organizationId" AS organization_id,
    p."piiRedactionLevel" AS pii_level,
    (
      '{}'::jsonb
      || CASE p."capturedInputVisibility"
           WHEN 'VISIBLE_TO_ADMIN' THEN jsonb_build_object('input', jsonb_build_object('disposition', 'restrict', 'audience', jsonb_build_object('admins', true)))
           WHEN 'REDACTED_TO_ALL' THEN jsonb_build_object('input', jsonb_build_object('disposition', 'restrict', 'audience', '{}'::jsonb))
           ELSE '{}'::jsonb
         END
      || CASE p."capturedOutputVisibility"
           WHEN 'VISIBLE_TO_ADMIN' THEN jsonb_build_object('output', jsonb_build_object('disposition', 'restrict', 'audience', jsonb_build_object('admins', true)))
           WHEN 'REDACTED_TO_ALL' THEN jsonb_build_object('output', jsonb_build_object('disposition', 'restrict', 'audience', '{}'::jsonb))
           ELSE '{}'::jsonb
         END
    ) AS categories
  FROM "Project" p
  JOIN "Team" t ON t."id" = p."teamId"
  WHERE p."capturedInputVisibility" <> 'VISIBLE_TO_ALL'
     OR p."capturedOutputVisibility" <> 'VISIBLE_TO_ALL'
     OR p."piiRedactionLevel" <> 'ESSENTIAL'
)
INSERT INTO "DataPrivacyPolicy" ("id", "organizationId", "scopeType", "scopeId", "personalOnly", "config", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  pl.organization_id,
  'PROJECT',
  pl.project_id,
  false,
  (
    (CASE WHEN pl.categories <> '{}'::jsonb THEN jsonb_build_object('categories', pl.categories) ELSE '{}'::jsonb END)
    || (CASE pl.pii_level
          WHEN 'STRICT' THEN jsonb_build_object('pii', jsonb_build_object('level', 'strict'))
          WHEN 'DISABLED' THEN jsonb_build_object('pii', jsonb_build_object('level', 'disabled'))
          ELSE '{}'::jsonb
        END)
  ),
  now(),
  now()
FROM project_legacy pl
ON CONFLICT ("scopeType", "scopeId", "personalOnly") DO NOTHING;

-- Drop the legacy columns now that the policy carries their posture.
ALTER TABLE "Organization" DROP COLUMN "governanceLogContentMode";
ALTER TABLE "Project" DROP COLUMN "piiRedactionLevel";
ALTER TABLE "Project" DROP COLUMN "capturedInputVisibility";
ALTER TABLE "Project" DROP COLUMN "capturedOutputVisibility";

-- Both enum types are now unused at the database level. The trace-processing
-- pipeline keeps its own PII-level enum in TypeScript (commands.ts), so dropping
-- the Prisma types here does not affect the ingestion path.
DROP TYPE "ProjectSensitiveDataVisibilityLevel";
DROP TYPE "PIIRedactionLevel";
