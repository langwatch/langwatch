-- AlterTable
ALTER TABLE "LlmPromptConfigVersion" ADD COLUMN "runtimeParameters" JSONB NOT NULL DEFAULT '{}';
