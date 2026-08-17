-- AlterTable
ALTER TABLE "Grant" ADD COLUMN     "resourceKind" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "createdByUserId" TEXT;

-- CreateTable
CREATE TABLE "GrantUsage" (
    "grantId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrantUsage_pkey" PRIMARY KEY ("grantId")
);

-- CreateIndex
CREATE INDEX "Grant_projectId_resourceKind_scopeId_idx" ON "Grant"("projectId", "resourceKind", "scopeId");

-- CreateIndex
CREATE INDEX "GrantUsage_organizationId_idx" ON "GrantUsage"("organizationId");
