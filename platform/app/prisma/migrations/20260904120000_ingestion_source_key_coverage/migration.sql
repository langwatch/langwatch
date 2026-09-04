-- Which gateway keys a connected provider bill pays for (ADR-128 wave 2, section 7).
--
-- The screens show a provider bill and the gateway's own metering as separate
-- lanes today. The moment they are merged into one figure, "every dollar has
-- one home" stops being structural and starts needing an answer to: does a
-- bill already claim this key's spend? That answer is an administrator's
-- explicit mapping, and this is where it lives.
--
-- DATED, and that is the whole design. Coverage is read as of the day being
-- drawn, so re-pointing a key from Bill 1 to Bill 2 in June leaves May filed
-- under Bill 1. A list column on "IngestionSource" would be rewritten wholesale
-- on every edit, silently re-filing every past month the next time a chart was
-- drawn - history edited by a present-tense edit.
--
-- A SEPARATE TABLE, because that is what lets the database hold the rule. The
-- one-open-bill index below refuses a second bill claiming an already-covered
-- key, rather than letting the last administrator to hit Save win.
--
-- PLAIN POSTGRES ONLY, deliberately. An exclusion constraint over the validity
-- range would also refuse an overlap against closed history, but it needs the
-- btree_gist extension - a contrib package a self-hosted server or a managed
-- provider's allow-list may not have. The identity tables made the same trade
-- (see 20260902120000_governance_identity_and_erasure): a partial unique index
-- on the open row catches the race that actually happens, and closed history is
-- kept non-overlapping by the service, which only ever writes a closed row by
-- closing the open one inside a transaction that holds it FOR UPDATE.

-- +-------------------------------------------------------------------------+
-- | IngestionSourceKeyCoverage - the key-to-bill mapping                     |
-- +-------------------------------------------------------------------------+
CREATE TABLE "IngestionSourceKeyCoverage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ingestionSourceId" TEXT NOT NULL,
    "virtualKeyId" TEXT NOT NULL,
    -- UTC midnight only, enforced by the service: the rollup buckets spend with
    -- toStartOfDay, so a day is the finest thing a bill can own. Not a database
    -- constraint, because the column is a naive TIMESTAMP(3) and "midnight" is
    -- a statement about the caller's calendar - a CHECK here would read the
    -- session's own time zone and reject a legitimate write from another one.
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionSourceKeyCoverage_pkey" PRIMARY KEY ("id")
);

-- One organization's mapping, and the per-source list shown beside the source's
-- own configuration.
CREATE INDEX "IngestionSourceKeyCoverage_organizationId_sourceId_idx" ON "IngestionSourceKeyCoverage"("organizationId", "ingestionSourceId");

-- Resolving which bill covered a key on the day being drawn.
CREATE INDEX "IngestionSourceKeyCoverage_organizationId_key_validFrom_idx" ON "IngestionSourceKeyCoverage"("organizationId", "virtualKeyId", "validFrom");

-- A zero-width range (validFrom = validTo) is closed the instant it begins, so
-- the one-open-bill index below never sees it - and it would still be read
-- back as history, filing a bill against no time at all. An inverted range is
-- the same mistake with a sign error. One named CHECK rejects both, in the
-- database.
ALTER TABLE "IngestionSourceKeyCoverage" ADD CONSTRAINT "IngestionSourceKeyCoverage_valid_range_check"
    CHECK ("validTo" IS NULL OR "validTo" > "validFrom");

-- At most one OPEN bill per key. The race this exists for: two administrators
-- claim a so-far uncovered key at once, each finds no open row to lock, and
-- this index is the only thing that sees them collide - SQLSTATE 23505,
-- surfaced by Prisma as P2002. It deliberately says nothing about CLOSED
-- history: rows are only ever closed, never inserted closed, by a service
-- transaction that holds the open row FOR UPDATE (see the header above for why
-- that trade is taken over an exclusion constraint).
CREATE UNIQUE INDEX "IngestionSourceKeyCoverage_one_open_bill_key"
    ON "IngestionSourceKeyCoverage"("virtualKeyId")
    WHERE "validTo" IS NULL;

-- +-------------------------------------------------------------------------+
-- | The row's organization must be the organization of BOTH ends            |
-- +-------------------------------------------------------------------------+
-- relationMode = "prisma" means neither "virtualKeyId" nor "ingestionSourceId"
-- is a real foreign key, so nothing here would otherwise stop a coverage row
-- naming one organization while the key or the bill it points at belongs to
-- another - which is one organization's bill claiming another's spend.
--
-- Two triggers rather than two composite foreign keys, because the repo does
-- not have real foreign keys to add one to: relationMode = "prisma" is a
-- whole-schema choice, and a composite key here would also need a
-- (organizationId, id) unique index on each parent that exists for no other
-- reason. A cascade is deliberately not part of either: dropping coverage
-- discards which bill paid for which key and when, and the IRREVERSIBLE note
-- at the foot of this file is about exactly that.
CREATE OR REPLACE FUNCTION "ingestion_source_key_coverage_key_org_check"()
RETURNS TRIGGER AS $$
DECLARE
    key_org TEXT;
BEGIN
    -- FOR KEY SHARE, and it is the whole difference between this check holding
    -- and merely appearing to. A plain SELECT reads a key that a concurrent
    -- session is about to delete, finds it, and lets the insert through; that
    -- session's delete then fires the orphan-drop trigger below and finds
    -- nothing, because this row is not committed yet. Both transactions commit,
    -- and the coverage row outlives its key. The share lock makes the deleting
    -- session wait for this insert instead, so the orphan-drop trigger runs
    -- after the row exists and does see it. (Reproduced and the fix verified on
    -- PostgreSQL 16.14.)
    SELECT "organizationId" INTO key_org FROM "VirtualKey" WHERE "id" = NEW."virtualKeyId" FOR KEY SHARE;
    IF key_org IS NULL THEN
        RAISE EXCEPTION 'Gateway key % does not exist, so no bill can be recorded as covering it.', NEW."virtualKeyId"
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF key_org <> NEW."organizationId" THEN
        RAISE EXCEPTION 'Gateway key % belongs to a different organization than the coverage row naming it.', NEW."virtualKeyId"
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "IngestionSourceKeyCoverage_key_org_check"
    BEFORE INSERT OR UPDATE OF "virtualKeyId", "organizationId" ON "IngestionSourceKeyCoverage"
    FOR EACH ROW EXECUTE FUNCTION "ingestion_source_key_coverage_key_org_check"();

-- The same check on the other end of the row. Without it a coverage row can
-- name another organization's connected bill, and that organization's spend is
-- then attributed to a bill its owner never mapped - the same hazard as the key
-- side, reached from the opposite direction.
CREATE OR REPLACE FUNCTION "ingestion_source_key_coverage_source_org_check"()
RETURNS TRIGGER AS $$
DECLARE
    source_org TEXT;
BEGIN
    -- A plain SELECT, and the asymmetry with the key check above is deliberate.
    -- That one takes FOR KEY SHARE to close a race with its own AFTER DELETE
    -- trigger on "VirtualKey"; no such trigger exists on "IngestionSource", so
    -- there is no delete-side statement here for a share lock to serialise
    -- against, and taking one anyway would add a third row to the lock order
    -- for nothing.
    SELECT "organizationId" INTO source_org FROM "IngestionSource" WHERE "id" = NEW."ingestionSourceId";
    IF source_org IS NULL THEN
        RAISE EXCEPTION 'Connected bill % does not exist, so it cannot be recorded as covering a gateway key.', NEW."ingestionSourceId"
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF source_org <> NEW."organizationId" THEN
        RAISE EXCEPTION 'Connected bill % belongs to a different organization than the coverage row naming it.', NEW."ingestionSourceId"
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "IngestionSourceKeyCoverage_source_org_check"
    BEFORE INSERT OR UPDATE OF "ingestionSourceId", "organizationId" ON "IngestionSourceKeyCoverage"
    FOR EACH ROW EXECUTE FUNCTION "ingestion_source_key_coverage_source_org_check"();

-- The same absence of real foreign keys means nothing removes coverage when its
-- key is deleted. An orphaned open row holds that key's one open slot forever,
-- so a key later created with the same id could never be covered by anything.
--
-- This trigger only reaches rows that exist when the delete runs, which is why
-- the check above takes FOR KEY SHARE: without that lock an insert racing this
-- delete commits a row neither statement ever sees, and the pair of triggers
-- covers every ordering except the one that matters.
CREATE OR REPLACE FUNCTION "ingestion_source_key_coverage_drop_orphans"()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM "IngestionSourceKeyCoverage" WHERE "virtualKeyId" = OLD."id";
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "VirtualKey_drop_coverage_on_delete"
    AFTER DELETE ON "VirtualKey"
    FOR EACH ROW EXECUTE FUNCTION "ingestion_source_key_coverage_drop_orphans"();

-- IRREVERSIBLE: dropping "IngestionSourceKeyCoverage" discards which bill paid
-- for which gateway key, and when. That mapping is an administrator's stated
-- knowledge, not something any pull can rediscover - the re-pointing history
-- goes with it, so even re-entering today's mapping would re-file every past
-- month under today's answer.
--
-- Repair goes forward, in a new migration.
--   DROP TRIGGER "VirtualKey_drop_coverage_on_delete" ON "VirtualKey";
--   DROP FUNCTION "ingestion_source_key_coverage_drop_orphans"();
--   DROP TRIGGER "IngestionSourceKeyCoverage_source_org_check" ON "IngestionSourceKeyCoverage";
--   DROP FUNCTION "ingestion_source_key_coverage_source_org_check"();
--   DROP TRIGGER "IngestionSourceKeyCoverage_key_org_check" ON "IngestionSourceKeyCoverage";
--   DROP FUNCTION "ingestion_source_key_coverage_key_org_check"();
--   DROP TABLE "IngestionSourceKeyCoverage";
