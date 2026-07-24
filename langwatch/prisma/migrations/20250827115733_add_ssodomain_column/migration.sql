-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "ssoProvider" TEXT;

-- CreateIndex
CREATE INDEX "Organization_ssoProvider_idx" ON "Organization"("ssoProvider");
