-- The moment a virtual key stops serving, or null for a key that never
-- expires. Nullable with no default and no backfill: null means "never", which
-- is what every key written before this column was added meant.
--
-- No index: the column is read on a row already resolved by its unique secret
-- hash, so the comparison costs nothing and an index would only slow writes.
--
-- To roll back, uncomment and run manually. Dropping the column discards every
-- expiration date customers have set, and each of those keys goes back to
-- serving forever.
-- ALTER TABLE "VirtualKey" DROP COLUMN "expiresAt";

ALTER TABLE "VirtualKey" ADD COLUMN "expiresAt" TIMESTAMP(3);
