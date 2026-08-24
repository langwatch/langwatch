-- One row per brokered realtime voice session (ADR-097).
--
-- The gateway keeps no session state of its own. A voice session outlives the
-- request that minted it, the vendor's post-call report lands on whichever
-- replica answers next, and the per-key open-session cap has to be counted
-- somewhere every replica sees.
--
-- The primary key IS the gateway request id, so this row and the request's
-- spend record are one aggregate seen from two sides. No conversation content
-- is stored: the media socket runs client to vendor and never reaches here.
--
-- To roll back, uncomment and run manually. Dropping the table loses every
-- open session, so any call in flight at that moment settles as cost-unknown
-- when its grace expires and a late vendor report finds nothing to match.
-- DROP TABLE "GatewayRealtimeSession";
-- DROP TYPE "GatewayRealtimeSessionStatus";

CREATE TYPE "GatewayRealtimeSessionStatus" AS ENUM ('OPEN', 'CLOSED', 'FAILED', 'EXPIRED');

CREATE TABLE "GatewayRealtimeSession" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "virtualKeyId" TEXT NOT NULL,
    "modelProviderId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "agentId" TEXT,
    "model" TEXT NOT NULL,
    "vendorConversationId" TEXT,
    "status" "GatewayRealtimeSessionStatus" NOT NULL DEFAULT 'OPEN',
    "mintedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "vendorCostRaw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayRealtimeSession_pkey" PRIMARY KEY ("id")
);

-- The cap count: how many sessions one key holds open inside the window.
CREATE INDEX "GatewayRealtimeSession_virtualKeyId_status_mintedAt_idx"
    ON "GatewayRealtimeSession"("virtualKeyId", "status", "mintedAt");

-- The webhook lookup. Unique so a redelivered post-call report resolves to
-- exactly one session; NULL until the mint reports an id, and Postgres treats
-- NULLs as distinct, so any number of sessions may still be uncorrelated.
CREATE UNIQUE INDEX "GatewayRealtimeSession_vendor_vendorConversationId_key"
    ON "GatewayRealtimeSession"("vendor", "vendorConversationId");

-- The fallback match when no conversation id was reported, and the sweep that
-- expires rows no report ever closed.
CREATE INDEX "GatewayRealtimeSession_projectId_status_mintedAt_idx"
    ON "GatewayRealtimeSession"("projectId", "status", "mintedAt");
