-- Backs the fire-history keyset walk (trigger-fire-history.prisma.repository):
-- WHERE "projectId" = ? AND "triggerId" = ? (plus the cursor predicate)
-- ORDER BY "createdAt" DESC, "id" DESC — a backward scan over this index.
CREATE INDEX "TriggerSent_projectId_triggerId_createdAt_id_idx" ON "TriggerSent"("projectId", "triggerId", "createdAt", "id");
