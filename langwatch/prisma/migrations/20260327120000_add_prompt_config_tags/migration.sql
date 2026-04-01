-- CreateTable
CREATE TABLE "PromptVersionTag" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "PromptVersionTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromptVersionTag_configId_idx" ON "PromptVersionTag"("configId");

-- CreateIndex
CREATE INDEX "PromptVersionTag_versionId_idx" ON "PromptVersionTag"("versionId");

-- CreateIndex
CREATE INDEX "PromptVersionTag_projectId_idx" ON "PromptVersionTag"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersionTag_configId_tag_key" ON "PromptVersionTag"("configId", "tag");

-- AddForeignKey
ALTER TABLE "PromptVersionTag" ADD CONSTRAINT "PromptVersionTag_configId_fkey" FOREIGN KEY ("configId") REFERENCES "LlmPromptConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptVersionTag" ADD CONSTRAINT "PromptVersionTag_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LlmPromptConfigVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptVersionTag" ADD CONSTRAINT "PromptVersionTag_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptVersionTag" ADD CONSTRAINT "PromptVersionTag_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
