-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "elasticsearchApiKey" TEXT,
ADD COLUMN     "elasticsearchNodeUrl" TEXT,
ADD COLUMN     "useCustomElasticsearch" BOOLEAN NOT NULL DEFAULT false;

