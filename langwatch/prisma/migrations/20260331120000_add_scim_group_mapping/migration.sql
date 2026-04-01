-- CreateTable
CREATE TABLE "ScimGroupMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalGroupId" TEXT NOT NULL,
    "externalGroupName" TEXT NOT NULL,
    "teamId" TEXT,
    "role" "TeamUserRole",
    "customRoleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScimGroupMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScimGroupMembership" (
    "scimGroupMappingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScimGroupMembership_pkey" PRIMARY KEY ("scimGroupMappingId","userId")
);

-- CreateIndex
CREATE INDEX "ScimGroupMapping_organizationId_idx" ON "ScimGroupMapping"("organizationId");

-- CreateIndex
CREATE INDEX "ScimGroupMapping_teamId_idx" ON "ScimGroupMapping"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ScimGroupMapping_organizationId_externalGroupId_key" ON "ScimGroupMapping"("organizationId", "externalGroupId");

-- CreateIndex
CREATE INDEX "ScimGroupMembership_userId_idx" ON "ScimGroupMembership"("userId");

-- CreateIndex (Team unique constraint for SCIM)
CREATE UNIQUE INDEX "Team_organizationId_externalScimId_key" ON "Team"("organizationId", "externalScimId");

-- AddForeignKey
ALTER TABLE "ScimGroupMapping" ADD CONSTRAINT "ScimGroupMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimGroupMapping" ADD CONSTRAINT "ScimGroupMapping_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimGroupMapping" ADD CONSTRAINT "ScimGroupMapping_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "CustomRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimGroupMembership" ADD CONSTRAINT "ScimGroupMembership_scimGroupMappingId_fkey" FOREIGN KEY ("scimGroupMappingId") REFERENCES "ScimGroupMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimGroupMembership" ADD CONSTRAINT "ScimGroupMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
