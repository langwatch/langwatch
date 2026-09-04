-- Why a key was revoked. Nullable with no default, so this is a catalog-only
-- change: no rewrite of the table, no lock beyond the ALTER itself. Keys
-- revoked before this column exists keep NULL, which every reader treats as
-- "cause not recorded".
ALTER TABLE "ApiKey" ADD COLUMN "revocationCause" TEXT;
