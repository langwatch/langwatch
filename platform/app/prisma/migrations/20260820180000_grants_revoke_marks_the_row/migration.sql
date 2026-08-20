-- A revoke marks the row; it does not delete it.
--
-- Deleting made the projection order-dependent: a redelivered `attached`
-- arriving after a `revoked` would resurrect the grant, because there was no
-- row left to say otherwise. With a mark, the row is always there to lose the
-- comparison, and the `occurredAt` guard the projection writes under is
-- enough on its own — no cursor table, no read-before-write.
--
-- It also means a revoked grant is still answerable: when a grant ended, who
-- ended it, and why.
ALTER TABLE "Grant" ADD COLUMN "revokedAt" TIMESTAMP(3);
ALTER TABLE "Grant" ADD COLUMN "revokedReason" TEXT;

ALTER TABLE "Role" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Every read of a live grant now fences on the mark, so it belongs in the
-- index rather than as a filter over it.
CREATE INDEX "Grant_organizationId_scopeType_scopeId_live_idx"
  ON "Grant" ("organizationId", "scopeType", "scopeId")
  WHERE "revokedAt" IS NULL;

CREATE INDEX "Role_organizationId_live_idx"
  ON "Role" ("organizationId")
  WHERE "deletedAt" IS NULL;

-- The uniques have to become partial, or a soft-deleted row keeps its name
-- and its token forever: re-minting a share link with the same token, or
-- re-creating a role with a name someone once deleted, would collide with a
-- row nothing can see. Prisma cannot express a partial unique (the same
-- reason RoleBinding's six live in SQL rather than the schema), so these are
-- dropped and rebuilt here and deliberately NOT declared in schema.prisma.
DROP INDEX IF EXISTS "Grant_token_key";
CREATE UNIQUE INDEX "Grant_token_key"
  ON "Grant" ("token")
  WHERE "revokedAt" IS NULL;

DROP INDEX IF EXISTS "Role_organizationId_name_key";
CREATE UNIQUE INDEX "Role_organizationId_name_key"
  ON "Role" ("organizationId", "name")
  WHERE "deletedAt" IS NULL;
