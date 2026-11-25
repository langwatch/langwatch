-- The weekly digest's tables (enterprise/modules/digest); all new, so no lock on anything existing.
-- CreateTable
CREATE TABLE IF NOT EXISTS "DigestCohortOrganization" (
    "organizationId" TEXT NOT NULL,
    "enrolledBy" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestCohortOrganization_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DigestSubscription" (
    "userId" TEXT NOT NULL,
    "unsubscribedAt" TIMESTAMP(3),
    "unsubscribedFromSendId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestSubscription_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DigestProjectWeek" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "isoWeek" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "projectionVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestProjectWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DigestUserWeek" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "isoWeek" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "projectionVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestUserWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DigestSend" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "isoWeek" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DigestSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "armed" BOOLEAN NOT NULL DEFAULT false,
    "lastPlannedWeek" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DigestProjectWeek_organizationId_isoWeek_idx" ON "DigestProjectWeek"("organizationId", "isoWeek");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DigestProjectWeek_isoWeek_idx" ON "DigestProjectWeek"("isoWeek");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DigestUserWeek_organizationId_isoWeek_idx" ON "DigestUserWeek"("organizationId", "isoWeek");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DigestUserWeek_isoWeek_idx" ON "DigestUserWeek"("isoWeek");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DigestUserWeek_userId_idx" ON "DigestUserWeek"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DigestSend_userId_idx" ON "DigestSend"("userId");
