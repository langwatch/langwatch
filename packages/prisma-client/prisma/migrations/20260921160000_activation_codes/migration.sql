-- IRREVERSIBLE: no down step. Dropping this table would lose which codes were
-- issued, to whom, and which have already been redeemed, and a redeemed
-- single-use code would become redeemable again. Rolling the code back is
-- safe: the table stays unread and an install activates by pasting a license.
--
-- Connected self-hosted (ADR-139, section 5): the short code a fresh install
-- pastes instead of a license blob. Redeeming it mints the license the code
-- describes.
--
-- The table holds a hash of the code, never the code. Redemption hashes what
-- the caller presented before looking it up, so the stored value is a step
-- away from anything that could be presented.
--
-- Additive only: one new table, nothing else touched.

CREATE TABLE "ActivationCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeHint" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "planType" TEXT NOT NULL,
    "maxMembers" INTEGER NOT NULL,
    "maxMembersLite" INTEGER NOT NULL DEFAULT 0,
    "licenseTermDays" INTEGER NOT NULL,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "reusable" BOOLEAN NOT NULL DEFAULT false,
    "redeemedAt" TIMESTAMP(3),
    "redeemedByInstanceId" TEXT,
    "issuedLicenseId" TEXT,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivationCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActivationCode_codeHash_key" ON "ActivationCode"("codeHash");

CREATE INDEX "ActivationCode_organizationId_idx" ON "ActivationCode"("organizationId");

CREATE INDEX "ActivationCode_expiresAt_idx" ON "ActivationCode"("expiresAt");
