-- IRREVERSIBLE: no down step. Dropping connectServicesDisabled would lose which
-- hosted services each customer refused, which nothing else records, and every
-- refused service would silently switch back on. Rolling the code back is safe:
-- the column stays unread and the install calls no hosted service.
--
-- Connected self-hosted (ADR-139, section 2): which hosted services an
-- organization has switched off.
--
-- The column records refusals rather than approvals so that the entitled state
-- and the default state agree. A customer who bought hosted judging gets it
-- working without first finding a settings page, and an explicit refusal
-- survives a licence change instead of being re-granted by it.
--
-- Additive only: one array column defaulting to empty, so every organization
-- starts with no refusal on record.

ALTER TABLE "Organization" ADD COLUMN "connectServicesDisabled" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
