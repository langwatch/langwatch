CREATE TABLE IF NOT EXISTS "GatewayA2ATarget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "cardUrl" TEXT NOT NULL,
    "upstreamUrl" TEXT NOT NULL,
    "encryptedUpstreamHeaders" TEXT,
    "restrictToAllowList" BOOLEAN NOT NULL DEFAULT false,
    "allowedVirtualKeyIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blockReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "GatewayA2ATarget_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GatewayA2ATarget_organizationId_projectId_idx" ON "GatewayA2ATarget"("organizationId", "projectId");
