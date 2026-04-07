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

    CONSTRAINT "RoleBinding_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RoleBinding_principal_check" CHECK (
        ("userId" IS NOT NULL AND "groupId" IS NULL) OR
        ("userId" IS NULL AND "groupId" IS NOT NULL)
    ),
    CONSTRAINT "RoleBinding_custom_role_check" CHECK (
        ("role" != 'CUSTOM') OR ("customRoleId" IS NOT NULL)
    )
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
