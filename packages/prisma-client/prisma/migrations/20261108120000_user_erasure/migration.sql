-- IRREVERSIBLE: creates the "UserErasure" table.
-- A rollback leaves it in place; dropping it is an operator step confirmed in Ops.
-- One row per erased account, holding only its creation time, so an erasure never makes a later
-- account the install's first-created one (modules/user/specs/user.feature).
CREATE TABLE IF NOT EXISTS "UserErasure" (
    "id" TEXT NOT NULL,
    "accountCreatedAt" TIMESTAMP(3) NOT NULL,
    "erasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserErasure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserErasure_accountCreatedAt_idx" ON "UserErasure"("accountCreatedAt");
