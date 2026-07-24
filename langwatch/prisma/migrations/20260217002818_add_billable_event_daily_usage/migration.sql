-- CreateTable
CREATE TABLE "ProjectDailyBillableEvents" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastEventTimestamp" BIGINT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDailyBillableEvents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectDailyBillableEvents_projectId_date_idx" ON "ProjectDailyBillableEvents"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDailyBillableEvents_projectId_date_key" ON "ProjectDailyBillableEvents"("projectId", "date");
