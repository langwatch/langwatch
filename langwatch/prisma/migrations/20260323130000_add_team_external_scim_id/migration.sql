-- AlterTable
ALTER TABLE "Team" ADD COLUMN "externalScimId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Team_organizationId_externalScimId_key" ON "Team"("organizationId", "externalScimId");
