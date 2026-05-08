-- Langy assistant tables — see specs/assistant/memory-design.md §3

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

-- LangyProjectMemory
CREATE TABLE "LangyProjectMemory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentSummary" TEXT,
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEditorId" TEXT,

    CONSTRAINT "LangyProjectMemory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LangyProjectMemory_projectId_key" ON "LangyProjectMemory"("projectId");
CREATE INDEX "LangyProjectMemory_projectId_idx" ON "LangyProjectMemory"("projectId");

-- LangyProjectMemoryHistory
CREATE TABLE "LangyProjectMemoryHistory" (
    "id" TEXT NOT NULL,
    "projectMemoryId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contentVersion" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "changedById" TEXT,
    "changeReason" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LangyProjectMemoryHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LangyProjectMemoryHistory_projectMemoryId_changedAt_idx" ON "LangyProjectMemoryHistory"("projectMemoryId", "changedAt");
CREATE INDEX "LangyProjectMemoryHistory_projectId_idx" ON "LangyProjectMemoryHistory"("projectId");

-- LangyUserPreferences
CREATE TABLE "LangyUserPreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'non_expert',
    "dismissedSuggestionKinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LangyUserPreferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LangyUserPreferences_userId_projectId_key" ON "LangyUserPreferences"("userId", "projectId");
CREATE INDEX "LangyUserPreferences_projectId_idx" ON "LangyUserPreferences"("projectId");
