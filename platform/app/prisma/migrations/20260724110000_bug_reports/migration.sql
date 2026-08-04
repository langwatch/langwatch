-- CreateTable
CREATE TABLE "BugReport" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "sessionData" TEXT,
    "sessionTruncated" BOOLEAN NOT NULL DEFAULT false,
    "agent" TEXT,
    "contactEmail" TEXT,
    "cliVersion" TEXT,
    "linkedProjectId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "BugReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BugReport_createdAt_idx" ON "BugReport"("createdAt");
