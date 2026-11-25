-- Authz's own engine switch, one row per organization: the engine answers its permission checks
-- while "onEngine" is true. A new, empty table filled by authz's carry-over step; no lock on any
-- existing table. Column refs only, no foreign key.
CREATE TABLE IF NOT EXISTS "AuthzEngineSwitch" (
    "organizationId" TEXT NOT NULL,
    "onEngine" BOOLEAN NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "switchedAt" TIMESTAMP(3) NOT NULL,
    "lastAppliedEventId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthzEngineSwitch_pkey" PRIMARY KEY ("organizationId")
);

-- Down (manual rollback; uncomment and run):
-- DROP TABLE IF EXISTS "AuthzEngineSwitch";
