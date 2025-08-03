-- Populate organizationId based on project -> team -> organization relationship
UPDATE "LlmPromptConfig"
SET "organizationId" = (
    SELECT t."organizationId"
    FROM "Project" p
    JOIN "Team" t ON p."teamId" = t."id"
    WHERE p."id" = "LlmPromptConfig"."projectId"
)
WHERE "organizationId" IS NULL;