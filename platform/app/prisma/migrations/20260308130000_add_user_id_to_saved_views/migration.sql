-- AlterTable
ALTER TABLE "SavedView" ADD COLUMN "userId" TEXT;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "SavedView_userId_idx" ON "SavedView"("userId");
