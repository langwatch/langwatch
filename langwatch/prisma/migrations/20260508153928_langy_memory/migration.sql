-- Langy assistant tables — chat threads + messages.
-- Project memory / user preferences were planned but cut from v1.

-- LangyConversation
CREATE TABLE "LangyConversation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "sharedAt" TIMESTAMP(3),
    "sharedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LangyConversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LangyConversation_projectId_userId_updatedAt_idx" ON "LangyConversation"("projectId", "userId", "updatedAt");
CREATE INDEX "LangyConversation_projectId_isShared_updatedAt_idx" ON "LangyConversation"("projectId", "isShared", "updatedAt");
CREATE INDEX "LangyConversation_deletedAt_idx" ON "LangyConversation"("deletedAt");

-- LangyMessage
CREATE TABLE "LangyMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "parts" JSONB NOT NULL,
    "tokenCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LangyMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LangyMessage_conversationId_createdAt_idx" ON "LangyMessage"("conversationId", "createdAt");
CREATE INDEX "LangyMessage_projectId_idx" ON "LangyMessage"("projectId");
