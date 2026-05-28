-- Drop the @@unique([organizationId, name]) constraint on VirtualKey.
--
-- Rationale: VK name is a human-readable label for the operator. It does
-- not appear in any lookup path (the gateway resolves keys by hashedSecret
-- prefix; the UI and audit log identify rows by id). Forcing uniqueness
-- bit the user when revoking a key and minting a fresh one under the same
-- name: revoked rows are kept for audit history but were holding the slot
-- on (organizationId, name), so the second create failed with a Prisma
-- P2002 surfaced to the frontend as raw SQL. The user reasonably wanted
-- to reuse the label; if the operator chooses ambiguous names that's
-- their concern, not the schema's.
--
-- Forward-only. No data migration: the data stays, only the unique
-- index is dropped. Prisma implements `@@unique` as a UNIQUE INDEX
-- (not a table CONSTRAINT), so DROP INDEX is the right knob.

DROP INDEX IF EXISTS "VirtualKey_organizationId_name_key";
