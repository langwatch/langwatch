-- AlterTable
ALTER TABLE "RoleBinding" ADD COLUMN     "patId" TEXT;

-- CreateTable
CREATE TABLE "PersonalAccessToken" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "lookupId" TEXT NOT NULL,
    "hashedSecret" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonalAccessToken_lookupId_key" ON "PersonalAccessToken"("lookupId");

-- CreateIndex
CREATE INDEX "PersonalAccessToken_userId_idx" ON "PersonalAccessToken"("userId");

-- CreateIndex
CREATE INDEX "PersonalAccessToken_organizationId_idx" ON "PersonalAccessToken"("organizationId");

-- CreateIndex
CREATE INDEX "PersonalAccessToken_lookupId_idx" ON "PersonalAccessToken"("lookupId");

-- CreateIndex
CREATE INDEX "RoleBinding_patId_idx" ON "RoleBinding"("patId");

