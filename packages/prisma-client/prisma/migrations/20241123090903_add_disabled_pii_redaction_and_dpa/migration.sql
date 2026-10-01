-- AlterEnum
ALTER TYPE "PIIRedactionLevel" ADD VALUE 'DISABLED';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "signedDPA" BOOLEAN NOT NULL DEFAULT false;
