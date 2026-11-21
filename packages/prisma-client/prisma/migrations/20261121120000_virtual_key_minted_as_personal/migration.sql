-- Whether a virtual key was minted for one person: set with its principal, never cleared, so the
-- key stays personal after erasure nulls the principal. Existing keys are marked by the gateway's
-- background step `gateway:mark-personal-virtual-keys`, never by an UPDATE here.
ALTER TABLE "VirtualKey" ADD COLUMN IF NOT EXISTS "mintedAsPersonal" BOOLEAN NOT NULL DEFAULT false;
