-- IRREVERSIBLE: this migration only creates the BlockedSeatChange table.
-- Dropping a table is an operator step confirmed in Ops, never a migration.
CREATE TABLE IF NOT EXISTS "BlockedSeatChange" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "attempt" JSONB NOT NULL,
    "seats" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "BlockedSeatChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BlockedSeatChange_organizationId_idx" ON "BlockedSeatChange"("organizationId");
