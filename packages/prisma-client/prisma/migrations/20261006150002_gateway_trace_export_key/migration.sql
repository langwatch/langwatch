-- The ownerless trace-export key a gateway trace project's spans are sent with.
-- A new table nothing reads yet: the image still serving never names it.
CREATE TABLE "GatewayTraceExportKey" (
    "projectId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayTraceExportKey_pkey" PRIMARY KEY ("projectId")
);
