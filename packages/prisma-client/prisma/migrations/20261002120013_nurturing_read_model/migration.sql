-- CreateTable
CREATE TABLE "NurturingProject" (
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "NurturingProject_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "NurturingOrganization" (
    "organizationId" TEXT NOT NULL,
    "adminUserId" TEXT,
    "seeded" BOOLEAN NOT NULL DEFAULT false,
    "evaluationCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NurturingOrganization_pkey" PRIMARY KEY ("organizationId")
);

-- CreateIndex
CREATE INDEX "NurturingProject_organizationId_idx" ON "NurturingProject"("organizationId");
