-- AlterTable
ALTER TABLE "CustomLLMModelCost" ADD COLUMN "cacheCreation1hCostPerToken" DOUBLE PRECISION;

-- Down (manual rollback; uncomment and run). Dropping the column discards any
-- hour-long cache write rate a customer set, which cannot be recovered:
-- ALTER TABLE "CustomLLMModelCost" DROP COLUMN "cacheCreation1hCostPerToken";
