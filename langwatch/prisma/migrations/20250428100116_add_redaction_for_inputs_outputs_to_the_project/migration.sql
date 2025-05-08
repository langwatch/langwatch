-- CreateEnum
CREATE TYPE "ProjectSensitiveDataVisibilityLevel" AS ENUM ('REDACTED_TO_ALL', 'VISIBLE_TO_ADMIN', 'VISIBLE_TO_ALL');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "capturedInputVisibility" "ProjectSensitiveDataVisibilityLevel" NOT NULL DEFAULT 'VISIBLE_TO_ALL',
ADD COLUMN     "capturedOutputVisibility" "ProjectSensitiveDataVisibilityLevel" NOT NULL DEFAULT 'VISIBLE_TO_ALL';
