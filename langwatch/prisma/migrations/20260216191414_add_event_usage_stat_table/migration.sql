-- CreateTable
CREATE TABLE "ProjectDailySdkUsage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "sdkName" TEXT NOT NULL DEFAULT '',
    "sdkVersion" TEXT NOT NULL DEFAULT '',
    "sdkLanguage" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastEventTimestamp" BIGINT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDailySdkUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectDailySdkUsage_projectId_date_idx" ON "ProjectDailySdkUsage"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDailySdkUsage_projectId_date_sdkName_sdkVersion_sdkL_key" ON "ProjectDailySdkUsage"("projectId", "date", "sdkName", "sdkVersion", "sdkLanguage");
