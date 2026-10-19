-- AlterTable
ALTER TABLE "CustomLLMModelCost" ADD COLUMN "cacheReadCostPerToken" DOUBLE PRECISION,
ADD COLUMN "cacheCreationCostPerToken" DOUBLE PRECISION;
