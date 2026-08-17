-- CreateEnum
CREATE TYPE "GrantScopeType" AS ENUM ('ORGANIZATION', 'TEAM', 'PROJECT', 'RESOURCE', 'PLATFORM');

-- CreateEnum
CREATE TYPE "GrantPrincipalType" AS ENUM ('USER', 'API_KEY', 'GROUP', 'TEAM', 'ORGANIZATION', 'PROJECT', 'ANYONE');

-- CreateTable
CREATE TABLE "Grant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "principalType" "GrantPrincipalType" NOT NULL,
    "principalId" TEXT,
    "roleKey" TEXT,
    "scopeType" "GrantScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "token" TEXT,
    "permission" TEXT,
    "expiresAt" TIMESTAMP(3),
    "maxViews" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthzProjectionCursor" (
    "organizationId" TEXT NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "projectionVersion" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthzProjectionCursor_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "AuthzCutoverProjection" (
    "organizationId" TEXT NOT NULL,
    "onEngine" BOOLEAN NOT NULL DEFAULT false,
    "provedAt" TIMESTAMP(3),
    "parityDiffs" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthzCutoverProjection_pkey" PRIMARY KEY ("organizationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Grant_token_key" ON "Grant"("token");

-- CreateIndex
CREATE INDEX "Grant_organizationId_principalType_principalId_idx" ON "Grant"("organizationId", "principalType", "principalId");

-- CreateIndex
CREATE INDEX "Grant_organizationId_scopeType_scopeId_idx" ON "Grant"("organizationId", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "Role_organizationId_idx" ON "Role"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_organizationId_name_key" ON "Role"("organizationId", "name");

