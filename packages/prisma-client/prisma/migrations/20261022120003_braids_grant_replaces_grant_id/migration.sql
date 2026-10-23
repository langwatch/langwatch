-- ADR-183 §2: a braid change's attach names the braid it replaces, so a repeated change can tell its
-- own earlier attach from another identical braid. Nullable, no default and no backfill: every
-- existing row, and every grant that is not a braid change, reads null.
ALTER TABLE "Grant" ADD COLUMN IF NOT EXISTS "replacesGrantId" TEXT;
