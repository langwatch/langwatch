-- Add data retention policy fields to Organization and Project,
-- and create PinnedTrace model for trace retention exemption.

ALTER TABLE "Organization" ADD COLUMN "defaultRetentionPolicy" JSONB;

ALTER TABLE "Project" ADD COLUMN "retentionPolicy" JSONB;

CREATE TABLE "PinnedTrace" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "userId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PinnedTrace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PinnedTrace_projectId_traceId_key" ON "PinnedTrace"("projectId", "traceId");

CREATE INDEX "PinnedTrace_projectId_idx" ON "PinnedTrace"("projectId");
