-- Add a `kind` discriminator so the SavedView table can host both the
-- legacy /messages page's filter-map saved views and the new traces v2
-- lens configs in the same table without the two clients seeing each
-- other's entries.
-- Default to "v1-traces-filter" so every row that was created before
-- this migration keeps appearing in the legacy UI (which fetches
-- without an explicit kind filter and therefore lands on this default).
ALTER TABLE "SavedView"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'v1-traces-filter';

-- Index supports the common "give me views of THIS kind for THIS project"
-- query used by both clients. `order` is appended so the existing sort
-- (ascending order) can also be served from the index without an extra
-- in-memory sort on large lens counts.
CREATE INDEX "SavedView_projectId_kind_order_idx" ON "SavedView"("projectId", "kind", "order");
