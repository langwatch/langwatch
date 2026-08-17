-- State for the in-place system migrations runner
-- (@langwatch/system-migrations): one record per (migration, tenant),
-- written by the worker-boot pass that migrates each organization in the
-- background. "Pending" is the absence of a record; "finalized" is the
-- one-way latch that lets a tenant leave its legacy code path. The first
-- rider is the ADR-092 stage-B TeamUser backfill.
--
-- To roll back, uncomment and run manually. Dropping the table forgets
-- every tenant's migration progress: the next worker boot re-runs the
-- backfill (idempotent) and re-proves parity from scratch, and every
-- tenant falls back to its legacy path until it re-finalizes.
-- DROP TABLE "SystemMigrationTenantState";

-- CreateTable
CREATE TABLE "SystemMigrationTenantState" (
    "migrationName" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "report" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemMigrationTenantState_pkey" PRIMARY KEY ("migrationName","tenantId")
);

-- CreateIndex
CREATE INDEX "SystemMigrationTenantState_migrationName_status_idx" ON "SystemMigrationTenantState"("migrationName", "status");
