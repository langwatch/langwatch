-- Shrink GatewayProviderRotationPolicy to MANUAL only.
--
-- Iter 56 dogfood feedback (rchaves): AUTO and EXTERNAL_SECRET_STORE
-- were offered in the provider-binding drawer but never wired to any
-- scheduler or secret-store integration. Confusing UI with no
-- enforcement behind it. Rather than ship stubs, we ship one value
-- (MANUAL) and add scheduled rotation + external-store integration
-- properly in v1.1 when the provider side is designed.
--
-- Any existing rows with AUTO or EXTERNAL_SECRET_STORE silently
-- degrade to MANUAL — semantic preserved since neither value ever
-- triggered actual rotation logic.
--
-- To roll back, uncomment the reverse section and run manually.

BEGIN;

-- 1. Rename old enum out of the way.
ALTER TYPE "GatewayProviderRotationPolicy" RENAME TO "GatewayProviderRotationPolicy_v1";

-- 2. Create new single-value enum.
CREATE TYPE "GatewayProviderRotationPolicy" AS ENUM ('MANUAL');

-- 3. Cast every existing row onto the new enum. AUTO + EXTERNAL_SECRET_STORE
--    collapse to MANUAL because they were never enforced anyway.
ALTER TABLE "GatewayProviderCredential"
  ALTER COLUMN "rotationPolicy" DROP DEFAULT,
  ALTER COLUMN "rotationPolicy" TYPE "GatewayProviderRotationPolicy"
    USING ('MANUAL'::"GatewayProviderRotationPolicy"),
  ALTER COLUMN "rotationPolicy" SET DEFAULT 'MANUAL';

-- 4. Drop the dead enum.
DROP TYPE "GatewayProviderRotationPolicy_v1";

COMMIT;

-- Down migration (commented — Prisma migrations are append-only in CI;
-- manual only):
--
-- BEGIN;
-- ALTER TYPE "GatewayProviderRotationPolicy" RENAME TO "GatewayProviderRotationPolicy_manual_only";
-- CREATE TYPE "GatewayProviderRotationPolicy" AS ENUM ('AUTO', 'MANUAL', 'EXTERNAL_SECRET_STORE');
-- ALTER TABLE "GatewayProviderCredential"
--   ALTER COLUMN "rotationPolicy" DROP DEFAULT,
--   ALTER COLUMN "rotationPolicy" TYPE "GatewayProviderRotationPolicy"
--     USING ("rotationPolicy"::text::"GatewayProviderRotationPolicy"),
--   ALTER COLUMN "rotationPolicy" SET DEFAULT 'MANUAL';
-- DROP TYPE "GatewayProviderRotationPolicy_manual_only";
-- COMMIT;
