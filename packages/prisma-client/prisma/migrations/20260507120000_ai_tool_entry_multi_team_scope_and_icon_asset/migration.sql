-- Adds multi-team scope + uploadable icon support to AiToolEntry.
--
-- Additive on the AiToolEntry side: keeps `scope`, `scopeId`, `iconKey`
-- columns for back-compat during the rollout. New writes populate the
-- AiToolEntryTeam join table for team-scope and the iconAsset column
-- for icon source. A follow-up migration drops the legacy columns
-- once every reader has been migrated to the new shape.

-- AiToolEntry.iconAsset — single column, prefix-discriminated:
--   "preset:claude_code" / "preset:codex" / ...   (built-in icon)
--   "data:image/svg+xml;base64,..."               (admin-uploaded)
--   NULL                                          (fall back to type
--                                                  default in UI)
ALTER TABLE "AiToolEntry" ADD COLUMN "iconAsset" TEXT;

-- AiToolEntryTeam — per-team scope binding. Empty set = org-wide.
-- Non-empty set = entry visible only to members of those teams.
CREATE TABLE "AiToolEntryTeam" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,

    CONSTRAINT "AiToolEntryTeam_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiToolEntryTeam_entryId_teamId_key"
    ON "AiToolEntryTeam"("entryId", "teamId");

CREATE INDEX "AiToolEntryTeam_teamId_idx" ON "AiToolEntryTeam"("teamId");

ALTER TABLE "AiToolEntryTeam"
    ADD CONSTRAINT "AiToolEntryTeam_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "AiToolEntry"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiToolEntryTeam"
    ADD CONSTRAINT "AiToolEntryTeam_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: existing scope='team' rows → one AiToolEntryTeam row each.
-- scope='organization' rows stay with empty teams[] (= org-wide).
-- Uses a UUID-ish id derived from the entry+team pair to stay
-- idempotent if this migration is rerun against a partially-backfilled
-- DB (rare, but cheap insurance).
INSERT INTO "AiToolEntryTeam" ("id", "entryId", "teamId")
SELECT
    'aite-' || substring(md5("id" || ':' || "scopeId") for 24),
    "id",
    "scopeId"
FROM "AiToolEntry"
WHERE "scope" = 'team'
ON CONFLICT ("entryId", "teamId") DO NOTHING;
