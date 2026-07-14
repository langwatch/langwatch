-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AnnotationScoreDataType" ADD VALUE 'OPTION';
ALTER TYPE "AnnotationScoreDataType" ADD VALUE 'CHECKBOX';

-- AlterTable
ALTER TABLE "AnnotationScore" ADD COLUMN     "defaultValue" JSONB,
ADD COLUMN     "global" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "dataType" DROP NOT NULL;
