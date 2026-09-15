ALTER TABLE "Check" RENAME TO "Monitor";

-- RenameIndex
ALTER INDEX "Check_experimentId_key" RENAME TO "Monitor_experimentId_key";

-- RenameIndex
ALTER INDEX "Check_projectId_idx" RENAME TO "Monitor_projectId_idx";

-- RenameIndex
ALTER INDEX "Check_projectId_slug_key" RENAME TO "Monitor_projectId_slug_key";