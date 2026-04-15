/*
  Warnings:

  - Made the column `metadata` on table `Notification` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Agent" DROP CONSTRAINT "Agent_copiedFromAgentId_fkey";

-- DropForeignKey
ALTER TABLE "Evaluator" DROP CONSTRAINT "Evaluator_copiedFromEvaluatorId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_subscriptionId_fkey";

-- DropForeignKey
ALTER TABLE "InvoiceItem" DROP CONSTRAINT "InvoiceItem_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "PromptTag" DROP CONSTRAINT "PromptTag_createdById_fkey";

-- DropForeignKey
ALTER TABLE "PromptTag" DROP CONSTRAINT "PromptTag_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "PromptTag" DROP CONSTRAINT "PromptTag_updatedById_fkey";

-- DropForeignKey
ALTER TABLE "PromptTagAssignment" DROP CONSTRAINT "PromptTagAssignment_configId_fkey";

-- DropForeignKey
ALTER TABLE "PromptTagAssignment" DROP CONSTRAINT "PromptTagAssignment_createdById_fkey";

-- DropForeignKey
ALTER TABLE "PromptTagAssignment" DROP CONSTRAINT "PromptTagAssignment_updatedById_fkey";

-- DropForeignKey
ALTER TABLE "PromptTagAssignment" DROP CONSTRAINT "PromptTagAssignment_versionId_fkey";

-- DropForeignKey
ALTER TABLE "SavedView" DROP CONSTRAINT "SavedView_projectId_fkey";

-- DropForeignKey
ALTER TABLE "SavedView" DROP CONSTRAINT "SavedView_userId_fkey";

-- DropForeignKey
ALTER TABLE "Scenario" DROP CONSTRAINT "Scenario_lastUpdatedById_fkey";

-- DropForeignKey
ALTER TABLE "Scenario" DROP CONSTRAINT "Scenario_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "TriggerSent" DROP CONSTRAINT "TriggerSent_customGraphId_fkey";

-- DropIndex
DROP INDEX "CustomGraph_id_key";

-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "metadata" SET NOT NULL;

-- AlterTable
ALTER TABLE "RoleBinding" ADD COLUMN     "patId" TEXT;

-- CreateTable
CREATE TABLE "PersonalAccessToken" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lookupId" TEXT NOT NULL,
    "hashedSecret" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonalAccessToken_lookupId_key" ON "PersonalAccessToken"("lookupId");

-- CreateIndex
CREATE INDEX "PersonalAccessToken_userId_idx" ON "PersonalAccessToken"("userId");

-- CreateIndex
CREATE INDEX "PersonalAccessToken_organizationId_idx" ON "PersonalAccessToken"("organizationId");

-- CreateIndex
CREATE INDEX "PersonalAccessToken_lookupId_idx" ON "PersonalAccessToken"("lookupId");

-- CreateIndex
CREATE INDEX "RoleBinding_patId_idx" ON "RoleBinding"("patId");
