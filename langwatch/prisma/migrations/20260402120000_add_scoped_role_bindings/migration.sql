-- AlterTable: add externalScimId to Team for SCIM group provisioning
ALTER TABLE "Team" ADD COLUMN "externalScimId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Team_organizationId_externalScimId_key" ON "Team"("organizationId", "externalScimId");

-- CreateEnum
CREATE TYPE "RoleBindingScopeType" AS ENUM ('ORGANIZATION', 'TEAM', 'PROJECT');

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "externalId" TEXT,
    "scimSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMembership" (
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMembership_pkey" PRIMARY KEY ("userId","groupId")
);

-- CreateTable
CREATE TABLE "RoleBinding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "groupId" TEXT,
    "role" "TeamUserRole" NOT NULL,
    "customRoleId" TEXT,
    "scopeType" "RoleBindingScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Group_organizationId_slug_key" ON "Group"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Group_organizationId_externalId_key" ON "Group"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "Group_organizationId_idx" ON "Group"("organizationId");

-- CreateIndex
CREATE INDEX "GroupMembership_userId_idx" ON "GroupMembership"("userId");

-- CreateIndex
CREATE INDEX "GroupMembership_groupId_idx" ON "GroupMembership"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleBinding_userId_groupId_role_scopeType_scopeId_key" ON "RoleBinding"("userId", "groupId", "role", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "RoleBinding_organizationId_idx" ON "RoleBinding"("organizationId");

-- CreateIndex
CREATE INDEX "RoleBinding_userId_idx" ON "RoleBinding"("userId");

-- CreateIndex
CREATE INDEX "RoleBinding_groupId_idx" ON "RoleBinding"("groupId");

-- CreateIndex
CREATE INDEX "RoleBinding_scopeType_scopeId_idx" ON "RoleBinding"("scopeType", "scopeId");
