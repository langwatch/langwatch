-- ADR-039 phase 4. Covering index for the reporter's work queue
-- (organizationId + reportedAt IS NULL, ordered by sealedHour): keeps a
-- post-outage backlog drain an index walk instead of a filter+sort.

-- CreateIndex
CREATE INDEX "StorageUsageHourly_organizationId_reportedAt_sealedHour_idx" ON "StorageUsageHourly"("organizationId", "reportedAt", "sealedHour");

-- Down (commented out; to roll back, run manually):
-- DROP INDEX "StorageUsageHourly_organizationId_reportedAt_sealedHour_idx";
