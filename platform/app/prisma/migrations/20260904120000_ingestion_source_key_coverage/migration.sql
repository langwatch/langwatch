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
-- exclusion constraint below refuses a second bill claiming an already-covered
-- key, rather than letting the last administrator to hit Save win.
--
-- Uses btree_gist, installed by 20260902120000_governance_identity_and_erasure.
-- The availability guard is repeated rather than assumed: this migration must
-- fail with an actionable message on a server where the extension is missing,
-- not half-apply and leave the overlap rule off. A missing overlap guard is
-- invisible until two bills claim one key and the read picks one.

-- +-------------------------------------------------------------------------+
-- | btree_gist availability guard                                            |
-- +-------------------------------------------------------------------------+
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'btree_gist') THEN
    RAISE EXCEPTION
      'btree_gist is not available on this PostgreSQL server, so the gateway-key coverage table cannot be created. It ships with the standard contrib package. Install the server''s contrib/extension package (postgresql-contrib on Debian/Ubuntu, postgresqlNN-contrib on RHEL), or enable btree_gist in your managed provider''s allowed-extensions list, then re-run the migration.';
  END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS btree_gist;

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

-- A zero-width range (validFrom = validTo) is EMPTY, and an empty range
-- overlaps nothing - not even itself - so it slips past the exclusion
-- constraint below entirely and files a bill against no time at all. An
-- inverted range raises a raw type error (SQLSTATE 22000) that no layer maps.
-- One named CHECK rejects both, in the database.
ALTER TABLE "IngestionSourceKeyCoverage" ADD CONSTRAINT "IngestionSourceKeyCoverage_valid_range_check"
    CHECK ("validTo" IS NULL OR "validTo" > "validFrom");

-- At most one bill may cover a key at any given instant. Two OPEN rows both
-- range to infinity, so this rejects the second with SQLSTATE 23P01; a closed
-- row overlapping an open one is rejected the same way. NO partial unique index
-- is added on top: it would be strictly redundant, and would make the common
-- race surface as 23505 instead - two error codes for one rule, and the
-- application would have to handle both to say one sentence.
ALTER TABLE "IngestionSourceKeyCoverage" ADD CONSTRAINT "IngestionSourceKeyCoverage_no_overlap"
    EXCLUDE USING gist (
        "virtualKeyId" WITH =,
        tsrange("validFrom", COALESCE("validTo", 'infinity')) WITH &&
    );

-- +-------------------------------------------------------------------------+
-- | The row's organization must be its key's organization                    |
-- +-------------------------------------------------------------------------+
-- relationMode = "prisma" means "virtualKeyId" is not a real foreign key, so
-- nothing here would otherwise stop a coverage row naming one organization
-- while the key it points at belongs to another - which is one organization's
-- bill claiming another's spend.
CREATE OR REPLACE FUNCTION "ingestion_source_key_coverage_key_org_check"()
RETURNS TRIGGER AS $$
DECLARE
    key_org TEXT;
BEGIN
    SELECT "organizationId" INTO key_org FROM "VirtualKey" WHERE "id" = NEW."virtualKeyId";
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

-- The same absence of real foreign keys means nothing removes coverage when its
-- key is deleted. An orphaned open row holds that key's one open slot forever,
-- so a key later created with the same id could never be covered by anything.
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
--   DROP TRIGGER "IngestionSourceKeyCoverage_key_org_check" ON "IngestionSourceKeyCoverage";
--   DROP FUNCTION "ingestion_source_key_coverage_key_org_check"();
--   DROP TABLE "IngestionSourceKeyCoverage";
--   -- btree_gist is left installed: the identity tables depend on it.
