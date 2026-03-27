-- CreateTable
CREATE TABLE "LlmPromptConfigLabel" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmPromptConfigLabel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmPromptConfigLabel_configId_idx" ON "LlmPromptConfigLabel"("configId");

-- CreateIndex
CREATE INDEX "LlmPromptConfigLabel_versionId_idx" ON "LlmPromptConfigLabel"("versionId");

-- CreateIndex
CREATE INDEX "LlmPromptConfigLabel_projectId_idx" ON "LlmPromptConfigLabel"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "LlmPromptConfigLabel_configId_name_key" ON "LlmPromptConfigLabel"("configId", "name");

-- Seed built-in labels for existing prompts
-- For each existing prompt, create "production" and "staging" labels pointing to the highest version
INSERT INTO "LlmPromptConfigLabel" ("id", "configId", "name", "versionId", "projectId", "createdAt", "updatedAt")
SELECT
    'label_' || gen_random_uuid()::text,
    lpc."id",
    'production',
    lv."id",
    lpc."projectId",
    NOW(),
    NOW()
FROM "LlmPromptConfig" lpc
INNER JOIN LATERAL (
    SELECT v."id"
    FROM "LlmPromptConfigVersion" v
    WHERE v."configId" = lpc."id"
    ORDER BY v."version" DESC
    LIMIT 1
) lv ON true
WHERE lpc."deletedAt" IS NULL;

INSERT INTO "LlmPromptConfigLabel" ("id", "configId", "name", "versionId", "projectId", "createdAt", "updatedAt")
SELECT
    'label_' || gen_random_uuid()::text,
    lpc."id",
    'staging',
    lv."id",
    lpc."projectId",
    NOW(),
    NOW()
FROM "LlmPromptConfig" lpc
INNER JOIN LATERAL (
    SELECT v."id"
    FROM "LlmPromptConfigVersion" v
    WHERE v."configId" = lpc."id"
    ORDER BY v."version" DESC
    LIMIT 1
) lv ON true
WHERE lpc."deletedAt" IS NULL;
