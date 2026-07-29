-- AlterTable
ALTER TABLE "User" ADD COLUMN     "expiredIngestKeyAt" TIMESTAMP(3),
ADD COLUMN     "expiredIngestKeyDismissedAt" TIMESTAMP(3);
