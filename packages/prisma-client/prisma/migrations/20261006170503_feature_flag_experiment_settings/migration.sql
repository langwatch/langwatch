-- CreateEnum
CREATE TYPE "FeatureFlagExperimentSubjectType" AS ENUM ('USER', 'ORGANIZATION', 'PROJECT');

-- CreateTable
CREATE TABLE "FeatureFlagExperimentSetting" (
    "flagKey" TEXT NOT NULL,
    "subjectType" "FeatureFlagExperimentSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "changedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureFlagExperimentSetting_pkey" PRIMARY KEY ("flagKey","subjectType","subjectId")
);

-- CreateIndex
CREATE INDEX "FeatureFlagExperimentSetting_subjectType_subjectId_idx" ON "FeatureFlagExperimentSetting"("subjectType", "subjectId");
