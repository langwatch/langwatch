-- CreateTable
CREATE TABLE "CustomRole" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamUserCustomRole" (
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "customRoleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamUserCustomRole_pkey" PRIMARY KEY ("userId","teamId")
);

-- CreateIndex
CREATE INDEX "CustomRole_organizationId_idx" ON "CustomRole"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomRole_organizationId_name_key" ON "CustomRole"("organizationId", "name");

-- CreateIndex
CREATE INDEX "TeamUserCustomRole_teamId_idx" ON "TeamUserCustomRole"("teamId");

-- CreateIndex
CREATE INDEX "TeamUserCustomRole_userId_idx" ON "TeamUserCustomRole"("userId");

-- CreateIndex
CREATE INDEX "TeamUserCustomRole_customRoleId_idx" ON "TeamUserCustomRole"("customRoleId");
