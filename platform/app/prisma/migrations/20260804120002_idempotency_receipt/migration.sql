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
-- `responseBody` is the original response's exact bytes, AES-256-GCM encrypted
-- under CREDENTIALS_SECRET, the same treatment the automations webhook gives
-- its custom headers. It is encrypted because two of the four creates answer
-- with a secret that exists in readable form nowhere else: the virtual key's
-- secret and the webhook endpoint's signing secret are both shown once and
-- otherwise stored only as a hash. Replaying those responses is precisely why
-- a key is worth sending on those routes, so the secret has to transit this
-- row, and the row should not be the one place it sits in the clear. Expiry
-- bounds how long it exists at all.
--
-- Held as text rather than as a JSON document for a second reason: a string
-- round trip is what makes a replay byte-identical, since nothing in storage
-- is then in a position to reorder keys or renormalise the document.
--
-- Rows are dropped lazily, when an expired key is next presented, as are rows
-- that no longer decrypt because the secret was rotated under them. The
-- `expiresAt` index exists so an operator can prune in bulk as well, because a
-- key that is never retried is never revisited.

-- CreateTable
CREATE TABLE "IdempotencyReceipt" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyReceipt_scopeId_key_key" ON "IdempotencyReceipt"("scopeId", "key");

-- CreateIndex
CREATE INDEX "IdempotencyReceipt_expiresAt_idx" ON "IdempotencyReceipt"("expiresAt");
