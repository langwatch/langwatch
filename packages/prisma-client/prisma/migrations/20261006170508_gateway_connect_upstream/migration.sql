-- The hosted provider slot a connected install's gateway adds per organization (ADR-156 §8).
-- A new table nothing reads yet: the image still serving never names it.
CREATE TABLE "GatewayConnectUpstream" (
    "organizationId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GatewayConnectUpstream_pkey" PRIMARY KEY ("organizationId")
);
