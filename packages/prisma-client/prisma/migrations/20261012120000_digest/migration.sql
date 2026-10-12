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
    "links" JSONB NOT NULL,
    "messageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DigestClick" (
    "id" TEXT NOT NULL,
    "sendId" TEXT NOT NULL,
    "linkKey" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DigestUpdate" (
    "isoWeek" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "gradient" TEXT NOT NULL,
    "linkLabel" TEXT NOT NULL,
    "linkUrl" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestUpdate_pkey" PRIMARY KEY ("isoWeek")
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
CREATE UNIQUE INDEX IF NOT EXISTS "DigestSend_userId_isoWeek_key" ON "DigestSend"("userId", "isoWeek");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DigestSend_isoWeek_templateId_idx" ON "DigestSend"("isoWeek", "templateId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DigestClick_sendId_idx" ON "DigestClick"("sendId");
