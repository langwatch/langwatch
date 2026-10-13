-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('CRITICAL', 'WARNING', 'INFO');

-- AlterTable
ALTER TABLE "Trigger" ADD COLUMN     "alertType" "AlertType",
ADD COLUMN     "message" TEXT;
