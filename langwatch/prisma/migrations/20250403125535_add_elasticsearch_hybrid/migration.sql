-- AlterTable
ALTER TABLE "Monitor" RENAME CONSTRAINT "Check_pkey" TO "Monitor_pkey";

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "elasticsearchApiKey" TEXT,
ADD COLUMN     "elasticsearchNodeUrl" TEXT,
ADD COLUMN     "useElasticsearch" BOOLEAN NOT NULL DEFAULT false;

-- RenameIndex
ALTER INDEX "Check_experimentId_key" RENAME TO "Monitor_experimentId_key";

-- RenameIndex
ALTER INDEX "Check_projectId_idx" RENAME TO "Monitor_projectId_idx";

-- RenameIndex
ALTER INDEX "Check_projectId_slug_key" RENAME TO "Monitor_projectId_slug_key";
