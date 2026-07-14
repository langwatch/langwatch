-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "license" TEXT;
ALTER TABLE "Organization" ADD COLUMN "licenseExpiresAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "licenseLastValidatedAt" TIMESTAMP(3);
