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

-- Partial unique indexes for PAT-principal bindings. Mirrors the four existing
-- indexes for user/group principals from 20260410120000_fix_role_binding_unique_custom_role.
-- Without these, the same PAT could be granted the same (role, scope) twice,
-- or the same (customRole, scope) twice — silently duplicating permissions.

-- PAT bindings — built-in roles (customRoleId IS NULL)
CREATE UNIQUE INDEX "RoleBinding_pat_builtin_role_scope_key"
  ON "RoleBinding"("patId", "role", "scopeType", "scopeId")
  WHERE "patId" IS NOT NULL AND "customRoleId" IS NULL;

-- PAT bindings — custom roles (different customRoleIds are distinct at the same scope)
CREATE UNIQUE INDEX "RoleBinding_pat_custom_role_scope_key"
  ON "RoleBinding"("patId", "customRoleId", "scopeType", "scopeId")
  WHERE "patId" IS NOT NULL AND "customRoleId" IS NOT NULL;

