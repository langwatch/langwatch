-- ADR-203: private model endpoints staff register for one organization, and the hostnames the
-- organization binds to them. Two new, empty tables owned by model-provider. Column refs only,
-- no foreign key: the model-provider service removes an endpoint's bindings with it.
--
-- Spec: specs/security/org-private-model-endpoints.feature
--
-- To roll back by hand:
--
--   DROP TABLE "PrivateModelEndpointBinding";
--   DROP TABLE "PrivateModelEndpoint";

CREATE TABLE IF NOT EXISTS "PrivateModelEndpoint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "addresses" TEXT[],
    "port" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrivateModelEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PrivateModelEndpoint_organizationId_idx"
    ON "PrivateModelEndpoint" ("organizationId");

CREATE TABLE IF NOT EXISTS "PrivateModelEndpointBinding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrivateModelEndpointBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PrivateModelEndpointBinding_organizationId_hostname_key"
    ON "PrivateModelEndpointBinding" ("organizationId", "hostname");

CREATE INDEX IF NOT EXISTS "PrivateModelEndpointBinding_endpointId_idx"
    ON "PrivateModelEndpointBinding" ("endpointId");
