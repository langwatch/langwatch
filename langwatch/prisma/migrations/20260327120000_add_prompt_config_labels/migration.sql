-- CreateTable
CREATE TABLE "LlmPromptConfigLabel" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedById" TEXT,

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

-- AddForeignKey
ALTER TABLE "LlmPromptConfigLabel" ADD CONSTRAINT "LlmPromptConfigLabel_configId_fkey" FOREIGN KEY ("configId") REFERENCES "LlmPromptConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmPromptConfigLabel" ADD CONSTRAINT "LlmPromptConfigLabel_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LlmPromptConfigVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
