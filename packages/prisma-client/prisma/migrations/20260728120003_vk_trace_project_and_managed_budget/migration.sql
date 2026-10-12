-- Two columns, one review finding each.
--
-- VirtualKey.traceProjectId: where an org- or team-owned key's traces and
-- costs land. Stored apart from VirtualKeyScope because scope rows grant
-- access and visibility (assertCanOperateOnAnyScope authorizes against any
-- stored scope), and the trace destination must grant neither. No backfill:
-- existing keys resolve their destination from a unique PROJECT scope or
-- the governance project, exactly as before.
--
-- GatewayBudget.managedByVirtualKeyId: marks the one budget row the
-- virtual-key drawer's budget field manages. Clearing the field archives
-- only this row; independently created budgets keep their own lifecycle
-- and permission boundary. No backfill: pre-existing key-targeted budgets
-- stay unmanaged and are never archived implicitly.
--
-- Both additive and nullable; the rollback is dropping the columns.
ALTER TABLE "VirtualKey" ADD COLUMN "traceProjectId" TEXT;
ALTER TABLE "GatewayBudget" ADD COLUMN "managedByVirtualKeyId" TEXT;
CREATE INDEX "GatewayBudget_managedByVirtualKeyId_idx" ON "GatewayBudget"("managedByVirtualKeyId");

-- Down: (reversible, uncomment and run manually to roll back)
-- DROP INDEX "GatewayBudget_managedByVirtualKeyId_idx";
-- ALTER TABLE "GatewayBudget" DROP COLUMN "managedByVirtualKeyId";
-- ALTER TABLE "VirtualKey" DROP COLUMN "traceProjectId";
