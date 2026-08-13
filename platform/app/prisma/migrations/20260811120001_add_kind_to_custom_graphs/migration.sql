-- Add a `kind` discriminator so the CustomGraph table can host both the chart
-- builder's own graphs and saved governed SQL workbench charts, whose `graph`
-- column holds a versioned { sql, parameters, vegaLiteSpec } definition instead
-- of a builder payload. Sharing the table is what lets a saved workbench chart
-- inherit dashboard placement, ordering and cascading deletion unchanged.
--
-- Default to 'builder' so every row that existed before this migration is
-- labelled as what it already is. That is what lets the chart builder's reads
-- filter to 'builder' with no backfill, and it is also the value a builder
-- insert lands on without naming it. Nothing reinterprets an existing row: a
-- builder payload is never handed to the workbench definition parser.
ALTER TABLE "CustomGraph"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'builder';

-- Supports the "give me the charts of THIS kind for THIS project" read that both
-- clients issue, so neither pays for a full project scan followed by an
-- in-memory filter as the other kind's row count grows.
CREATE INDEX "CustomGraph_projectId_kind_idx" ON "CustomGraph"("projectId", "kind");
