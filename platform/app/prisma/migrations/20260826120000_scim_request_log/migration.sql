-- Every SCIM request we could attribute, and what we answered (ADR-126 - see
-- specs/identity/scim-request-log.feature).
--
-- "My provider says it is syncing and your page says no push yet" had no
-- answer anywhere in the product, and the person holding it is the person who
-- just pasted the token. A request that never reaches a handler is answered
-- and forgotten: an unparseable body is a 400, a lapsed plan is a 403, and
-- neither appends a fact - correctly, because neither is a fact about the
-- directory. Nothing was decided, so there is nothing to state.
--
-- So this is a TABLE and deliberately not an event:
--
--   * A request authors nothing. Event truth is what the system decided, and
--     a refused round trip decided nothing.
--   * It is not replayable truth. Rebuilding the world from the log must not
--     depend on how many times a provider retried a GET.
--   * It has a retention window. An event log does not; operational evidence
--     does, and rows outside the window are deleted.
--
-- NO ROW FOR A REQUEST WE CANNOT ATTRIBUTE. Nothing is written for a token
-- that does not verify. Two reasons, and the second is load-bearing: we do
-- not know whose organization to file it under, and a table unauthenticated
-- traffic can write is a table anybody on the internet can fill. That leaves
-- the most common setup failure there is - a mistyped or stale token -
-- structurally unable to appear on the page of the organization it was meant
-- for, and `ScimToken.lastUsedAt` staying null is the whole remedy available.
--
-- No foreign key, matching every other identity head on this schema
-- (`relationMode = "prisma"`), and no backfill: a table that starts empty
-- reads correctly, because "no requests recorded" and "no requests" are the
-- same sentence on a surface that has just been turned on.
CREATE TABLE "ScimRequestLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    -- Null when the refusal resolved an organization and stopped before the
    -- connection: a lapsed plan is answered off the token alone.
    "connectionId" TEXT,
    "method" TEXT NOT NULL,
    -- The resource asked for, never the raw path: a path carries ids and
    -- query strings, and this column is read by people.
    "resource" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    -- A stable slug, only on a refusal, so a reader branches on this and
    -- never on the sentence beside it.
    "reason" TEXT,
    -- Our own short sentence, customer-safe. Never a provider's own message.
    "detail" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScimRequestLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScimRequestLog_organizationId_occurredAt_idx" ON "ScimRequestLog"("organizationId", "occurredAt");

CREATE INDEX "ScimRequestLog_connectionId_occurredAt_idx" ON "ScimRequestLog"("connectionId", "occurredAt");

-- The retention sweep's own predicate.
CREATE INDEX "ScimRequestLog_occurredAt_idx" ON "ScimRequestLog"("occurredAt");
