-- CreateTable
CREATE TABLE IF NOT EXISTS "DataPrivacyProjectScope" (
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "teamId" TEXT,
    "isPersonal" BOOLEAN,
    "departmentId" TEXT,
    "teamRecordedAt" TIMESTAMP(3),
    "departmentRecordedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataPrivacyProjectScope_pkey" PRIMARY KEY ("projectId")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DataPrivacyProjectScope_organizationId_idx" ON "DataPrivacyProjectScope"("organizationId");
