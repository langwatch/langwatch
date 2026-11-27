-- IRREVERSIBLE: adds nullable columns to "OrganizationUser" and creates the "SeatHold" table.
-- A rollback leaves them in place; dropping them is an operator step confirmed in Ops.
-- Seat holds (specs/licensing/seat-rotation.feature): when a membership took its full seat,
-- when admission left it waiting, and the seats still counted after a removal.
ALTER TABLE "OrganizationUser" ADD COLUMN IF NOT EXISTS "fullSeatSince" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "seatPendingSince" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "SeatHold" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "seatTakenAt" TIMESTAMP(3) NOT NULL,
    "heldUntil" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SeatHold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SeatHold_organizationId_userId_key" ON "SeatHold"("organizationId", "userId");
CREATE INDEX IF NOT EXISTS "SeatHold_heldUntil_idx" ON "SeatHold"("heldUntil");
