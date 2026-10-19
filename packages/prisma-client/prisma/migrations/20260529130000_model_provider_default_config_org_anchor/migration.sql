-- Single-organization tenancy anchor for the junction-scoped models (ADR-021).
--
-- ModelProvider and ModelDefaultConfig target multiple scopes via their
-- per-feature junction tables and carry no organizationId column today, so
-- their tenant is inferred purely from scope rows. We add an organizationId
-- anchor (the org every scope resolves to under the single-organization
-- invariant) so the SQL guard and direct org-scoped admin queries can rely on
-- it. The column is nullable for one release while the production backfill is
-- verified; a follow-up migration sets NOT NULL once zero nulls is confirmed.

ALTER TABLE "ModelProvider" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "ModelDefaultConfig" ADD COLUMN "organizationId" TEXT;

-- Backfill ModelProvider.organizationId from its scope rows. Each scope
-- resolves to an organization (ORGANIZATION -> the scopeId itself, TEAM ->
-- the team's org, PROJECT -> the project's team's org). Every scope of one
-- provider resolves to the same org, so the earliest resolvable scope is
-- authoritative; orphaned scopes (pointing at a deleted team/project) resolve
-- to NULL and are skipped, leaving the provider for the NOT NULL follow-up.
UPDATE "ModelProvider" mp
SET "organizationId" = resolved.org_id
FROM (
  SELECT DISTINCT ON (mp_id) mp_id, org_id
  FROM (
    SELECT
      s."modelProviderId" AS mp_id,
      s."createdAt" AS created_at,
      CASE s."scopeType"
        WHEN 'ORGANIZATION' THEN s."scopeId"
        WHEN 'TEAM' THEN tt."organizationId"
        WHEN 'PROJECT' THEN pt."organizationId"
      END AS org_id
    FROM "ModelProviderScope" s
    LEFT JOIN "Team" tt ON s."scopeType" = 'TEAM' AND tt."id" = s."scopeId"
    LEFT JOIN "Project" pp ON s."scopeType" = 'PROJECT' AND pp."id" = s."scopeId"
    LEFT JOIN "Team" pt ON pp."teamId" = pt."id"
  ) per_scope
  WHERE org_id IS NOT NULL
  ORDER BY mp_id, created_at ASC
) resolved
WHERE mp."id" = resolved.mp_id;

-- Backfill ModelDefaultConfig.organizationId the same way from its scope rows.
UPDATE "ModelDefaultConfig" mdc
SET "organizationId" = resolved.org_id
FROM (
  SELECT DISTINCT ON (config_id) config_id, org_id
  FROM (
    SELECT
      s."configId" AS config_id,
      s."createdAt" AS created_at,
      CASE s."scopeType"
        WHEN 'ORGANIZATION' THEN s."scopeId"
        WHEN 'TEAM' THEN tt."organizationId"
        WHEN 'PROJECT' THEN pt."organizationId"
      END AS org_id
    FROM "ModelDefaultConfigScope" s
    LEFT JOIN "Team" tt ON s."scopeType" = 'TEAM' AND tt."id" = s."scopeId"
    LEFT JOIN "Project" pp ON s."scopeType" = 'PROJECT' AND pp."id" = s."scopeId"
    LEFT JOIN "Team" pt ON pp."teamId" = pt."id"
  ) per_scope
  WHERE org_id IS NOT NULL
  ORDER BY config_id, created_at ASC
) resolved
WHERE mdc."id" = resolved.config_id;

CREATE INDEX "ModelProvider_organizationId_idx" ON "ModelProvider" ("organizationId");
CREATE INDEX "ModelDefaultConfig_organizationId_idx" ON "ModelDefaultConfig" ("organizationId");

-- To roll back, uncomment and run manually:
-- DROP INDEX "ModelDefaultConfig_organizationId_idx";
-- DROP INDEX "ModelProvider_organizationId_idx";
-- ALTER TABLE "ModelDefaultConfig" DROP COLUMN "organizationId";
-- ALTER TABLE "ModelProvider" DROP COLUMN "organizationId";
