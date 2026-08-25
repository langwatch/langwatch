-- CreateTable
CREATE TABLE "SsoCredential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoProvider" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "oidcConfig" TEXT,
    "samlConfig" TEXT,
    "userId" TEXT,
    "providerId" TEXT NOT NULL,
    "organizationId" TEXT,
    "domain" TEXT NOT NULL,

    CONSTRAINT "SsoProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SsoCredential_organizationId_connectionId_idx" ON "SsoCredential"("organizationId", "connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "SsoProvider_providerId_key" ON "SsoProvider"("providerId");

-- CreateIndex
CREATE INDEX "SsoProvider_organizationId_idx" ON "SsoProvider"("organizationId");

-- CreateIndex
CREATE INDEX "SsoProvider_domain_idx" ON "SsoProvider"("domain");
