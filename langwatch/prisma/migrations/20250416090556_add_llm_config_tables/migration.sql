-- -- AlterTable
-- ALTER TABLE "Monitor" RENAME CONSTRAINT "Check_pkey" TO "Monitor_pkey";

-- CreateTable
CREATE TABLE "LlmPromptConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LlmPromptConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmPromptConfigVersion" (
    "id" TEXT NOT NULL,
    "version" SERIAL NOT NULL,
    "commitMessage" TEXT,
    "authorId" TEXT,
    "configId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "LlmPromptConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmPromptConfig_projectId_idx" ON "LlmPromptConfig"("projectId");

-- CreateIndex
CREATE INDEX "LlmPromptConfigVersion_configId_idx" ON "LlmPromptConfigVersion"("configId");

-- CreateIndex
CREATE INDEX "LlmPromptConfigVersion_authorId_idx" ON "LlmPromptConfigVersion"("authorId");

-- CreateIndex
CREATE INDEX "LlmPromptConfigVersion_createdAt_idx" ON "LlmPromptConfigVersion"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LlmPromptConfigVersion_configId_version_key" ON "LlmPromptConfigVersion"("configId", "version");