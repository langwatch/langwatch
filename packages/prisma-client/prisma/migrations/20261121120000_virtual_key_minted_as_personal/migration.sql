-- IRREVERSIBLE: no down step. A rollback leaves the column, which the previous release ignores;
-- dropping it loses which keys were minted for one member, so a drop is an operator step.
-- Set with a key's principal and never cleared, so the key stays personal once erasure nulls it.
-- Existing keys are marked by the background step `gateway:mark-personal-virtual-keys`.
ALTER TABLE "VirtualKey" ADD COLUMN IF NOT EXISTS "mintedAsPersonal" BOOLEAN NOT NULL DEFAULT false;
