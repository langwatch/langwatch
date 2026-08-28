-- Who a connection admits is ONE field, and the DECIDING is a separate one.
--
-- It was two fields for one question: a boolean `allowsJit` and
-- `arrivalPolicy`, kept in step by the fold. They disagreed about the middle
-- answer — the fold wrote `allowsJit = (policy = 'admit')`, so an
-- organization that chose "they ask, you approve" got a connection that
-- routed sign-ins and provisioned nobody. No account, no request, nobody to
-- approve. Two fields for one question can disagree; one cannot.
--
-- What a NULL policy used to carry, though, was a second thing: whether
-- anybody had CHOSEN. Going live waits on the choosing, and "turn everybody
-- away" is a choice. So that becomes its own column rather than being read
-- off the absence of an answer.
--
-- Order matters here. The deciding is backfilled while the policy can still
-- be NULL, because NULL is exactly what says nobody had decided.

-- 1. A connection that already carried a policy was decided when it was last
--    written. One that carried none was never decided at all.
ALTER TABLE "SsoConnection" ADD COLUMN "arrivalPolicyDecidedAt" TIMESTAMP(3);

UPDATE "SsoConnection"
SET "arrivalPolicyDecidedAt" = "occurredAt"
WHERE "arrivalPolicy" IS NOT NULL;

-- 2. Now every row takes an answer, and an undecided one takes the one its
--    boolean already gave, so nothing changes behaviour on the way through.
UPDATE "SsoConnection"
SET "arrivalPolicy" = CASE WHEN "allowsJit" THEN 'admit' ELSE 'refuse' END
WHERE "arrivalPolicy" IS NULL;

ALTER TABLE "SsoConnection" ALTER COLUMN "arrivalPolicy" SET DEFAULT 'refuse';
ALTER TABLE "SsoConnection" ALTER COLUMN "arrivalPolicy" SET NOT NULL;

-- 3. And the field that could disagree stops being written.
--
-- IT IS NOT DROPPED HERE, and the reason is the same one
-- `20260826120003_restore_session_impersonating_for_one_release` spells out
-- for `Session.impersonating`: `prisma migrate deploy` runs at container
-- start, so the first pod of a new release would drop the column while the
-- PREVIOUS release's pods are still selecting it. Those pods read the
-- connection with `findUnique` and no `select`, so Prisma emits an explicit
-- column list including `allowsJit` — every read fails with "column does not
-- exist", which is single sign-on routing and the connection projection both
-- stopping for the length of the rollout, with the projection's failed
-- applies stalling the fold behind them.
--
-- So this release stops READING it and leaves it in place, defaulted so a
-- previous-release pod still writing one gets a row the new code ignores. The
-- drop is `20260827120000_drop_sso_connection_allows_jit`, one release later,
-- which is the same expand-then-contract this wave already applies.
ALTER TABLE "SsoConnection" ALTER COLUMN "allowsJit" SET DEFAULT false;
