-- IRREVERSIBLE: no down step. Additive only: one new table, which the image still serving neither
-- reads nor writes. Dropping it would lose every notice staff wrote and who published it.

-- One row per notice LangWatch staff send self-hosted installs in the usage report reply
-- (enterprise/modules/licensing/specs/self-hosted-notices.feature). No tenant and no foreign key.
CREATE TABLE IF NOT EXISTS "SelfHostedNotice" (
    "id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "fixedIn" TEXT,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfHostedNotice_pkey" PRIMARY KEY ("id")
);
