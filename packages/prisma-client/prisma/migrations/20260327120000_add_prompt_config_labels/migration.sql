-- CreateTable
CREATE TABLE "PromptVersionLabel" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "PromptVersionLabel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromptVersionLabel_configId_idx" ON "PromptVersionLabel"("configId");

-- CreateIndex
CREATE INDEX "PromptVersionLabel_versionId_idx" ON "PromptVersionLabel"("versionId");

-- CreateIndex
CREATE INDEX "PromptVersionLabel_projectId_idx" ON "PromptVersionLabel"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersionLabel_configId_label_key" ON "PromptVersionLabel"("configId", "label");

-- AddForeignKey
ALTER TABLE "PromptVersionLabel" ADD CONSTRAINT "PromptVersionLabel_configId_fkey" FOREIGN KEY ("configId") REFERENCES "LlmPromptConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptVersionLabel" ADD CONSTRAINT "PromptVersionLabel_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LlmPromptConfigVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptVersionLabel" ADD CONSTRAINT "PromptVersionLabel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptVersionLabel" ADD CONSTRAINT "PromptVersionLabel_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
