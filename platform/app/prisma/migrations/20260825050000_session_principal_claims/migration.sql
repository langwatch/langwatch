-- The impersonation claims a session carries, aligned with the authz
-- Principal {actor, subject} (D06 - see
-- specs/identity/mfa-and-session-shape.feature and
-- dev/docs/identity-platform/D06-mfa-and-session-shape.md).
--
-- Additive and nullable, so nobody is signed out by it: every existing
-- session reads as an ordinary one with no impersonation on it, which is what
-- it is. The legacy `Session.impersonating` JSON column is still here and
-- still read after this migration; the two migrations that follow revoke the
-- sessions holding one and then drop it.
--
-- The index on `identifierId` is what makes per-identifier session revocation
-- a keyed delete rather than a scan of the session table. It was not needed
-- when the column was only written.
--
-- To roll back, uncomment and run manually. Nothing depends on these columns
-- for a session to be valid, so dropping them ends no session either.
-- DROP INDEX "Session_identifierId_idx";
-- ALTER TABLE "Session"
--   DROP COLUMN "actorUserId",
--   DROP COLUMN "subjectUserId",
--   DROP COLUMN "impersonationReason",
--   DROP COLUMN "impersonationExpiresAt";

ALTER TABLE "Session" ADD COLUMN     "actorUserId" TEXT,
ADD COLUMN     "subjectUserId" TEXT,
ADD COLUMN     "impersonationReason" TEXT,
ADD COLUMN     "impersonationExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Session_identifierId_idx" ON "Session"("identifierId");
