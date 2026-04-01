-- Rename PromptVersionLabel table to PromptVersionTag
ALTER TABLE "PromptVersionLabel" RENAME TO "PromptVersionTag";

-- Rename "label" column to "tag"
ALTER TABLE "PromptVersionTag" RENAME COLUMN "label" TO "tag";

-- Rename indexes
ALTER INDEX "PromptVersionLabel_pkey" RENAME TO "PromptVersionTag_pkey";
ALTER INDEX "PromptVersionLabel_configId_idx" RENAME TO "PromptVersionTag_configId_idx";
ALTER INDEX "PromptVersionLabel_versionId_idx" RENAME TO "PromptVersionTag_versionId_idx";
ALTER INDEX "PromptVersionLabel_projectId_idx" RENAME TO "PromptVersionTag_projectId_idx";
ALTER INDEX "PromptVersionLabel_configId_label_key" RENAME TO "PromptVersionTag_configId_tag_key";

-- Rename foreign key constraints
ALTER TABLE "PromptVersionTag" RENAME CONSTRAINT "PromptVersionLabel_configId_fkey" TO "PromptVersionTag_configId_fkey";
ALTER TABLE "PromptVersionTag" RENAME CONSTRAINT "PromptVersionLabel_versionId_fkey" TO "PromptVersionTag_versionId_fkey";
ALTER TABLE "PromptVersionTag" RENAME CONSTRAINT "PromptVersionLabel_createdById_fkey" TO "PromptVersionTag_createdById_fkey";
ALTER TABLE "PromptVersionTag" RENAME CONSTRAINT "PromptVersionLabel_updatedById_fkey" TO "PromptVersionTag_updatedById_fkey";
