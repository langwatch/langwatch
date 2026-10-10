-- Expand only: a nullable column and its index. The previous image never names
-- the column, and a rollback leaves it unread.
--
-- The seats a seat change raised a linked license from, written in the same
-- insert as the replacement license. Billing reads these facts through
-- licensing to invoice the added seats (ARCHITECTURE.md section 9).

-- AlterTable
ALTER TABLE "IssuedLicense" ADD COLUMN "seatsRaisedFrom" INTEGER;

-- CreateIndex
CREATE INDEX "IssuedLicense_seatsRaisedFrom_idx" ON "IssuedLicense"("seatsRaisedFrom");
