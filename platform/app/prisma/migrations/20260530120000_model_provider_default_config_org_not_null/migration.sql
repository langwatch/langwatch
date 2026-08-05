-- Tighten the ModelProvider + ModelDefaultConfig organization anchor to NOT
-- NULL (ADR-021 follow-up to 20260529130000_model_provider_default_config_org_anchor).
--
-- The anchor was added nullable so the backfill could resolve each row's org
-- from its scope rows. Any row still NULL after that backfill had only
-- orphaned scopes (pointing at a deleted team/project) or no scopes at all, so
-- it is unreachable through the scope-based access path and safe to remove.
-- Delete those dead rows, then enforce the anchor.

DELETE FROM "ModelProvider" WHERE "organizationId" IS NULL;
DELETE FROM "ModelDefaultConfig" WHERE "organizationId" IS NULL;

ALTER TABLE "ModelProvider" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ModelDefaultConfig" ALTER COLUMN "organizationId" SET NOT NULL;

-- To roll back, uncomment and run manually (the deleted dead rows are not
-- recoverable, but the constraint relaxation is):
-- ALTER TABLE "ModelDefaultConfig" ALTER COLUMN "organizationId" DROP NOT NULL;
-- ALTER TABLE "ModelProvider" ALTER COLUMN "organizationId" DROP NOT NULL;
