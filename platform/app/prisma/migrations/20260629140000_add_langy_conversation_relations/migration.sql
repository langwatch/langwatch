-- LangyConversation / LangyMessage relation indexes.
--
-- Adds @relation declarations for project/user/sharedBy with onDelete: Cascade
-- (SetNull for sharedBy). Under relationMode = "prisma" no FK constraint is
-- emitted to SQL — Prisma performs the cascade at the client layer. The only
-- shape this migration leaves on the database is the indexes Prisma requires
-- on every FK column.
--
-- LangyConversation.projectId is already covered by
-- ("projectId", "userId", "updatedAt"); LangyMessage."conversationId" and
-- LangyMessage."projectId" are covered by the existing indexes on those
-- models. New indexes are needed on:
--   - LangyConversation.userId       (user cascade lookups)
--   - LangyConversation.sharedById   (sharedBy SetNull lookups)
--   - LangyMessage.projectId already exists; LangyMessage adds no new index.

CREATE INDEX "LangyConversation_userId_idx"
  ON "LangyConversation"("userId");

CREATE INDEX "LangyConversation_sharedById_idx"
  ON "LangyConversation"("sharedById");
