-- CreateTable
CREATE TABLE "ProjectActiveDay" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectActiveDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectActiveDay_projectId_day_key" ON "ProjectActiveDay"("projectId", "day");
