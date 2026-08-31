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
-- LOCKING NOTE: plain `CREATE INDEX` takes a write lock on "Grant" for the
-- length of the build, so grant writes wait — on the authorization hot path.
-- `CREATE INDEX CONCURRENTLY` would avoid it but cannot run inside a
-- transaction, which the Prisma migration runner requires. This follows the
-- precedent of the four sibling "Grant" indexes deliberately, not by default:
-- the build is seconds on this table, it runs during deploy, and the fold is
-- the only writer and is idempotent, so a paused write retries rather than
-- fails.

-- CreateIndex
CREATE INDEX "Grant_organizationId_roleKey_live_idx"
  ON "Grant" ("organizationId", "roleKey")
  WHERE "revokedAt" IS NULL;

-- Down (manual rollback; uncomment and run). Only drops an index, so no row
-- data is lost. The API-key permission check goes back to scanning "Grant":
-- DROP INDEX "Grant_organizationId_roleKey_live_idx";
