-- CreateTable
CREATE TABLE "Analytics" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB,
    "numericValue" DOUBLE PRECISION,
    "stringValue" TEXT,
    "boolValue" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Analytics_projectId_idx" ON "Analytics"("projectId");

-- CreateIndex
CREATE INDEX "Analytics_key_projectId_createdAt_numericValue_idx" ON "Analytics"("key", "projectId", "createdAt", "numericValue");

-- CreateIndex
CREATE INDEX "Analytics_key_projectId_createdAt_boolValue_idx" ON "Analytics"("key", "projectId", "createdAt", "boolValue");

-- CreateIndex
CREATE INDEX "Analytics_key_projectId_createdAt_stringValue_idx" ON "Analytics"("key", "projectId", "createdAt", "stringValue");

-- CreateIndex
CREATE INDEX "Analytics_createdAt_idx" ON "Analytics"("createdAt");


