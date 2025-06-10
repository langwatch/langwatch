-- CreateEnum
CREATE TYPE "AnalyticsKey" AS ENUM ('PROJECT_ACTIVE_TODAY', 'PROJECT_TRACE_COUNT_PER_DAY');


-- CreateTable
CREATE TABLE "Analytics" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" "AnalyticsKey" NOT NULL,
    "value" JSONB NOT NULL,
    "numericValue" DOUBLE PRECISION,
    "stringValue" TEXT,
    "boolValue" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Analytics_projectId_idx" ON "Analytics"("projectId");

-- CreateIndex
CREATE INDEX "Analytics_key_idx" ON "Analytics"("key");

-- CreateIndex
CREATE INDEX "Analytics_createdAt_idx" ON "Analytics"("createdAt");

-- CreateIndex
CREATE INDEX "Analytics_projectId_key_idx" ON "Analytics"("projectId", "key");

-- CreateIndex
CREATE INDEX "Analytics_projectId_key_numericValue_idx" ON "Analytics"("projectId", "key", "numericValue");

-- CreateIndex
CREATE INDEX "Analytics_projectId_key_boolValue_idx" ON "Analytics"("projectId", "key", "boolValue");

