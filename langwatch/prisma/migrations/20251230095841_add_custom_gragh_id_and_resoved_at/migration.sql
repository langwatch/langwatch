-- AlterTable
ALTER TABLE "TriggerSent" ADD COLUMN     "customGraphId" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ALTER COLUMN "traceId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "TriggerSent_customGraphId_idx" ON "TriggerSent"("customGraphId");

-- CreateIndex
CREATE INDEX "TriggerSent_resolvedAt_idx" ON "TriggerSent"("resolvedAt");

-- AddForeignKey
ALTER TABLE "TriggerSent" ADD CONSTRAINT "TriggerSent_customGraphId_fkey" FOREIGN KEY ("customGraphId") REFERENCES "CustomGraph"("id") ON DELETE CASCADE ON UPDATE CASCADE;
