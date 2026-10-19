-- Identity's own sign-in switch, one row per user: the user signs in on the identifier path while
-- "onIdentifiers" is true. A new, empty table filled by identity's carry-over step and sign-up; no
-- lock on any existing table. Column refs only, no foreign key.
CREATE TABLE IF NOT EXISTS "IdentitySignInSwitch" (
    "userId" TEXT NOT NULL,
    "onIdentifiers" BOOLEAN NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "switchedAt" TIMESTAMP(3) NOT NULL,
    "lastAppliedEventId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdentitySignInSwitch_pkey" PRIMARY KEY ("userId")
);

-- Down (manual rollback; uncomment and run):
-- DROP TABLE IF EXISTS "IdentitySignInSwitch";
