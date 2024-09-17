-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "maxMembers" INTEGER,
ADD COLUMN     "maxMessagesPerMonth" INTEGER,
ADD COLUMN     "maxProjects" INTEGER;
