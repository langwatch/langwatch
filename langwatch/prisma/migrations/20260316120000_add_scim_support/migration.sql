-- AlterTable
ALTER TABLE "User" ADD COLUMN "externalId" TEXT,
ADD COLUMN "scimProvisioned" BOOLEAN NOT NULL DEFAULT false;
