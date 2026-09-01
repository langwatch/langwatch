-- The API-key permission check asks which custom roles a key holds, and only
-- it holds. `rolesExclusiveToApiKey()` issues that read through `liveGrants()`,
-- so the predicate is:
--
--   WHERE "organizationId" = $1 AND "roleKey" IN (...) AND "revokedAt" IS NULL
--
-- No existing index on "Grant" contains "roleKey". The closest,
-- "Grant_organizationId_scopeType_scopeId_live_idx", carries the right partial
-- clause but puts "scopeType" where "roleKey" would have to be, so only the
-- "organizationId" prefix is usable — and an organizationId prefix is exactly
-- what stops working here. Grants are skewed across organizations: once one
-- holds a large enough share of the table, matching its id narrows nothing,
-- the planner correctly rejects the index, and the read becomes a sequential
-- scan of the whole table. The largest organization pays the most, on every
-- API call, on the authorization hot path.
--
-- "LlmPromptConfig_organizationId_scope_idx" was added for the same failure
-- shape and its schema.prisma comment describes it in the same terms.
--
-- Partial on purpose, matching the sibling live index: every read of live
-- access fences on the mark, and RESOURCE rows carry a null "roleKey" and can
-- never satisfy the `IN` list, so keeping revoked and share-link rows out
-- holds the index to the rows the authorization path can actually return.
--
-- LOCKING NOTE: plain `CREATE INDEX` takes a lock on "Grant" that conflicts
-- with row writes for the length of the build. "Grant" has several writers on
-- live paths — the authz-grants fold
-- (`authz-grants-write.prisma.repository.ts`), revocation
-- (`authz-revocation.prisma.repository.ts`) and organization cleanup
-- (`organization.prisma.repository.ts`) — so a long build would make access
-- changes and offboarding wait, on the authorization hot path.
--
-- `CREATE INDEX CONCURRENTLY` is the usual answer but cannot run inside a
-- transaction, which the Prisma migration runner requires, so it is not
-- available here. Instead the build is fenced with a short `lock_timeout`:
-- if the lock is not free almost immediately, or the build cannot start
-- promptly, the statement aborts, the transaction rolls back and the deploy
-- fails loudly rather than queueing writes behind a held lock. Nothing is
-- half-applied — an index either exists or it does not.
--
-- ROLLBACK / RETRY: a timeout is not a data problem. Re-run the migration;
-- it takes the lock when the table is quiet. If it keeps timing out under
-- sustained write traffic, build the index out-of-band in a maintenance
-- window with the concurrent form and mark the migration applied:
--
--   CREATE INDEX CONCURRENTLY "Grant_organizationId_roleKey_live_idx"
--     ON "Grant" ("organizationId", "roleKey") WHERE "revokedAt" IS NULL;
--   -- then: prisma migrate resolve --applied 20260831120000_grant_org_role_key_live_index
--
-- Verify a concurrent build did not leave an invalid index:
--   SELECT indisvalid FROM pg_index
--    WHERE indexrelid = '"Grant_organizationId_roleKey_live_idx"'::regclass;
-- If it is false, `DROP INDEX` and retry.

SET LOCAL lock_timeout = '3s';

-- CreateIndex
CREATE INDEX "Grant_organizationId_roleKey_live_idx"
  ON "Grant" ("organizationId", "roleKey")
  WHERE "revokedAt" IS NULL;

-- Down (manual rollback; uncomment and run). Only drops an index, so no row
-- data is lost. The API-key permission check goes back to scanning "Grant":
-- DROP INDEX "Grant_organizationId_roleKey_live_idx";
