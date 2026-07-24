/*
  Warnings:

  - A unique constraint covering the columns `[handle]` on the table `LlmPromptConfig` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "PromptScope" AS ENUM ('ORGANIZATION', 'PROJECT');

-- AlterTable
ALTER TABLE "LlmPromptConfig" ADD COLUMN     "handle" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "scope" "PromptScope" NOT NULL DEFAULT 'PROJECT';

-- Update existing records to have handles in the format ${projectId}/${id}
-- Only for prompts that have been manually saved at least once (exclude auto-generated versions)
UPDATE "LlmPromptConfig"
SET "handle" = "projectId" || '/' || "id"
WHERE "handle" IS NULL
AND EXISTS (
    SELECT 1 FROM "LlmPromptConfigVersion"
    WHERE "LlmPromptConfigVersion"."configId" = "LlmPromptConfig"."id"
    AND "LlmPromptConfigVersion"."commitMessage" NOT IN ('Initial version', 'Save from legacy node')
);

-- CreateIndex
CREATE INDEX "LlmPromptConfig_organizationId_idx" ON "LlmPromptConfig"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LlmPromptConfig_handle_key" ON "LlmPromptConfig"("handle");
