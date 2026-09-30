-- IRREVERSIBLE: no down step. Dropping this table loses the identity this
-- install is known by, and a later release would mint a new one, which reads
-- on our side as a different install. Rolling the code back is safe: the table
-- stays unread and the old identity is derived again.
--
-- Connected self-hosted (ADR-139, section 2): the identity this install
-- presents to LangWatch.
--
-- Additive only: one new table, nothing written until the first report or the
-- first hosted call asks for the id.

CREATE TABLE "InstanceIdentity" (
    "id" TEXT NOT NULL DEFAULT 'self',
    "instanceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReportAt" TIMESTAMP(3),
    "lastReportError" TEXT,

    CONSTRAINT "InstanceIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstanceIdentity_instanceId_key" ON "InstanceIdentity"("instanceId");
