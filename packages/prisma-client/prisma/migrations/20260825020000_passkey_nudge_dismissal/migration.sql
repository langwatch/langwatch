-- Remembering that somebody said "not now" to being offered a passkey
-- (ADR-120, specs/identity/passkeys.feature).
--
-- One nullable column, no default, no backfill: NULL is "never asked", which
-- is true of every account that exists today. Nothing is rewritten and nobody
-- is signed out.
--
-- On the account rather than in browser storage on purpose. A per-browser
-- record forgets on a new device, which is exactly where the offer should be
-- more eager rather than less, and an interval that cannot be enforced across
-- devices is not an interval.
--
-- To roll back, uncomment and run manually. Dropping it loses only the
-- dismissals, which costs those people one repeated offer.
-- ALTER TABLE "User" DROP COLUMN "passkeyNudgeDismissedAt";

ALTER TABLE "User" ADD COLUMN "passkeyNudgeDismissedAt" TIMESTAMP(3);
