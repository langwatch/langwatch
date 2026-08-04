-- The stored outcome of a request that carried an `Idempotency-Key`.
--
-- Creates are the routes where a retry is dangerous: a caller whose connection
-- drops after the write but before the response has no way to tell a lost
-- request from a lost reply, and retrying mints a second virtual key, budget,
-- cache rule or webhook endpoint. This table is what lets the retry return the
-- first answer instead.
--
-- `scopeId` is the tenancy a key is unique within, and it differs per family
-- on purpose: the project on the gateway platform's creates, the organization
-- on the webhook platform's, each matching the scope that family authenticates
-- at. Keys are therefore private to a tenant and two tenants can pick the same
-- string without colliding.
--
-- A NULL `responseStatus` is the pending marker. The row is inserted before
-- the handler runs, so the unique index below is what serialises two
-- concurrent retries of the same key, and it is filled in only once the
-- handler succeeds. Failures delete their pending row rather than storing it:
-- the hazard idempotency exists to prevent is double creation, which only
-- happens on success.
--
-- `responseBody` is `json`, not the `jsonb` used by every other JSON column
-- here. jsonb normalises key order, which would make a replay answer the same
-- document with different bytes than the original request received; `json`
-- stores the text as written, so a replay is byte-for-byte identical.
--
-- Rows are dropped lazily, when an expired key is next presented. The
-- `expiresAt` index exists so an operator can prune in bulk as well, because a
-- key that is never retried is never revisited.

-- CreateTable
CREATE TABLE "IdempotencyReceipt" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSON,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyReceipt_scopeId_key_key" ON "IdempotencyReceipt"("scopeId", "key");

-- CreateIndex
CREATE INDEX "IdempotencyReceipt_expiresAt_idx" ON "IdempotencyReceipt"("expiresAt");
