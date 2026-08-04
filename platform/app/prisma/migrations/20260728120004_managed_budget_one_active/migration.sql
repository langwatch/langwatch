-- One ACTIVE drawer-managed budget per key, enforced by the database.
-- The service's find-then-create runs in a transaction, but two
-- concurrent updates could still each miss the other's row and insert a
-- second active managed budget; the drawer would then seed from an
-- arbitrary one. Archived rows are exempt: history keeps every
-- generation of the managed budget.
--
-- Defensive dedupe first: keep the newest active managed row per key,
-- archive the rest. No-op on databases written only by the linked
-- create path.
UPDATE "GatewayBudget" b
SET "archivedAt" = NOW()
WHERE b."managedByVirtualKeyId" IS NOT NULL
  AND b."archivedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM "GatewayBudget" newer
    WHERE newer."managedByVirtualKeyId" = b."managedByVirtualKeyId"
      AND newer."archivedAt" IS NULL
      AND (newer."createdAt" > b."createdAt"
           OR (newer."createdAt" = b."createdAt" AND newer.id > b.id))
  );

-- Partial uniques are not representable in schema.prisma; the schema
-- keeps the plain @@index and this constraint lives at the DB level.
CREATE UNIQUE INDEX "GatewayBudget_managed_one_active_key"
  ON "GatewayBudget"("managedByVirtualKeyId")
  WHERE "archivedAt" IS NULL AND "managedByVirtualKeyId" IS NOT NULL;

-- IRREVERSIBLE: the defensive dedupe above archives duplicate active
-- managed rows in place, and afterwards they are indistinguishable from
-- rows archived before this migration, so no down step can restore
-- them. The linked create path never produces duplicates, so on a
-- healthy database the dedupe is a no-op and the only effective change
-- is the index, which does reverse:
-- DROP INDEX "GatewayBudget_managed_one_active_key";
