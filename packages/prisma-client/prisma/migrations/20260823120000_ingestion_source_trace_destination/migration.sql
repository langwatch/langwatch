-- ADR-088 v7: optional trace destination for conversation-bearing pulls
-- (Databricks Genie). Null = don't route — every existing source keeps its
-- current behavior. The column is a destination, not a scope row: it grants
-- no access to the source, and the write path validates it names a project
-- of the source's own organization.
ALTER TABLE "IngestionSource" ADD COLUMN "traceProjectId" TEXT;

-- To roll back, uncomment and run manually. The column holds each source's
-- chosen destination; dropping it stops all conversation routing (traces
-- already routed stay in their project and age out per retention).
--
-- ALTER TABLE "IngestionSource" DROP COLUMN "traceProjectId";
