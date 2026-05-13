-- AlterTable
ALTER TABLE "LlmPromptConfigVersion" ADD COLUMN "runtimeConfig" JSONB NOT NULL DEFAULT '{}';
