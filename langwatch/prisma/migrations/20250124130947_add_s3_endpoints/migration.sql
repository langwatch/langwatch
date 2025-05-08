-- AlterTable
ALTER TABLE "Dataset" ADD COLUMN     "useS3" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "s3AccessKeyId" TEXT,
ADD COLUMN     "s3Endpoint" TEXT,
ADD COLUMN     "s3SecretAccessKey" TEXT,
ADD COLUMN     "useCustomS3" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "s3Bucket" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "s3AccessKeyId" TEXT,
ADD COLUMN     "s3Endpoint" TEXT,
ADD COLUMN     "s3SecretAccessKey" TEXT,
ADD COLUMN     "s3Bucket" TEXT;
