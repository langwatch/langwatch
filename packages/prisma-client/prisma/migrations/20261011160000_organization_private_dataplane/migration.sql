-- The first time an organization is routed to its own ClickHouse or S3, the organization module records
-- the variable's label here; a recorded organization whose route is later missing is refused, never
-- served from the shared stores (specs/private-dataplane/clickhouse-routing.feature).
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "privateClickHouseLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "privateS3Label" TEXT,
  ADD COLUMN IF NOT EXISTS "privateDataplaneSeenAt" TIMESTAMP(3);
