-- CreateEnum
CREATE TYPE "ProjectSensitiveDataVisibilityLevel" AS ENUM ('REDACTED_TO_ALL', 'VISIBLE_TO_ADMIN', 'VISIBLE_TO_ALL');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "capturedInputVisibility" "ProjectSensitiveDataVisibilityLevel" NOT NULL DEFAULT 'VISIBLE_TO_ALL',
ADD COLUMN     "capturedOutputVisibility" "ProjectSensitiveDataVisibilityLevel" NOT NULL DEFAULT 'VISIBLE_TO_ALL';

-- RenameIndex
ALTER INDEX "Check_experimentId_key" RENAME TO "Monitor_experimentId_key";

-- RenameIndex
ALTER INDEX "Check_projectId_idx" RENAME TO "Monitor_projectId_idx";

-- RenameIndex
ALTER INDEX "Check_projectId_slug_key" RENAME TO "Monitor_projectId_slug_key";
