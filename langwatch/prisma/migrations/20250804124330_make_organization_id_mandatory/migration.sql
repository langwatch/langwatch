-- Populate organizationId based on project -> team -> organization relationship
UPDATE "LlmPromptConfig"
SET "organizationId" = (
    SELECT t."organizationId"
    FROM "Project" p
    JOIN "Team" t ON p."teamId" = t."id"
    WHERE p."id" = "LlmPromptConfig"."projectId"
)
WHERE "organizationId" IS NULL;

/*
  Warnings:

  - Made the column `organizationId` on table `LlmPromptConfig` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "LlmPromptConfig" ALTER COLUMN "organizationId" SET NOT NULL;
