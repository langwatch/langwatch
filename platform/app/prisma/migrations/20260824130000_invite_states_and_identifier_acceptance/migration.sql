-- D11 (resilient invitations): revocation becomes a visible state instead of
-- a row delete, and acceptance records who came in and through which
-- verified identifier. EXPIRED is derived from `expiration`, never stored.
ALTER TYPE "INVITE_STATUS" ADD VALUE IF NOT EXISTS 'REVOKED';

ALTER TABLE "OrganizationInvite" ADD COLUMN "acceptedByUserId" TEXT;
ALTER TABLE "OrganizationInvite" ADD COLUMN "acceptedViaIdentifierId" TEXT;
