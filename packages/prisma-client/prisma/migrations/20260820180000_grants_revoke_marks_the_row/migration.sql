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

-- Every read of live access now fences on the mark, so it belongs in the
-- index rather than as a filter over it.
CREATE INDEX "Grant_organizationId_scopeType_scopeId_live_idx"
  ON "Grant" ("organizationId", "scopeType", "scopeId")
  WHERE "revokedAt" IS NULL;

CREATE INDEX "Role_organizationId_live_idx"
  ON "Role" ("organizationId")
  WHERE "deletedAt" IS NULL;

-- The uniques on "Grant"."token" and ("Role"."organizationId", name) stay
-- GLOBAL, deliberately. Making them partial would free a revoked token and a
-- deleted role's name for reuse, and a reissued share-link token is an old
-- link that works again — the one thing revoking it was for. A name or a
-- token that has been used stays used.
