-- ADR-107 §11: a process manager derives a state version exactly like a
-- fold, but no previous implementation ever stamped one, so no live row has
-- a value to pin against or gate on.
--
-- Nullable on purpose. A NOT NULL column fails every existing row's insert
-- default outright, and a store that treated NULL as a version mismatch
-- would throw on the very next read of every live process-manager instance
-- at once. The column is added empty; the store treats NULL as a legacy row
-- (accepted, not a decode failure) and stamps the real value the next time
-- that row is saved. Only once a row carries a real stamp does comparing it
-- against a pinned/derived version mean anything.
--
-- Reversible: DROP COLUMN "stateVersion" loses only the stamp itself, no
-- other constraint depends on it.

-- AlterTable
ALTER TABLE "ProcessManagerInstance" ADD COLUMN "stateVersion" TEXT;
