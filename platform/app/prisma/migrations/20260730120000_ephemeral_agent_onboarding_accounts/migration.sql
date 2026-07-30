-- AlterTable
-- Twin of "deactivatedAt": the row exists but is not a live actor. Set while a
-- user is an unclaimed placeholder created by anonymous agent onboarding.
ALTER TABLE "User" ADD COLUMN "unclaimedAt" TIMESTAMP(3);

-- CreateIndex
-- The reaper and the member/seat filters both ask "is this one unclaimed", and
-- the column is null for every ordinary user, so a partial index stays tiny.
CREATE INDEX "User_unclaimedAt_idx" ON "User"("unclaimedAt") WHERE "unclaimedAt" IS NOT NULL;

-- CreateTable
CREATE TABLE "EphemeralAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectSlug" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "claimTokenHash" TEXT NOT NULL,
    "fingerprintHash" TEXT,
    "ipHash" TEXT,
    "provisionedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ingestionStopsAt" TIMESTAMP(3),
    "deleteAfter" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "claimedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EphemeralAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EphemeralAccount_userId_key" ON "EphemeralAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EphemeralAccount_organizationId_key" ON "EphemeralAccount"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EphemeralAccount_projectId_key" ON "EphemeralAccount"("projectId");

-- CreateIndex
-- The claim token is the capability: this index is the only lookup an
-- unauthenticated caller can perform, and uniqueness is what makes a
-- collision impossible rather than merely unlikely.
CREATE UNIQUE INDEX "EphemeralAccount_claimTokenHash_key" ON "EphemeralAccount"("claimTokenHash");

-- CreateIndex
-- The reaper's work list is a range scan over this column.
CREATE INDEX "EphemeralAccount_deleteAfter_idx" ON "EphemeralAccount"("deleteAfter");

-- CreateIndex
CREATE INDEX "EphemeralAccount_ingestionStopsAt_idx" ON "EphemeralAccount"("ingestionStopsAt");

-- AddForeignKey
ALTER TABLE "EphemeralAccount" ADD CONSTRAINT "EphemeralAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EphemeralAccount" ADD CONSTRAINT "EphemeralAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
