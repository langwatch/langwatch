-- Drop the UserIngestionBinding subsystem (replaced by ingest-only ApiKey).
-- Forward-only: nothing live depends on this table.
DROP TABLE IF EXISTS "UserIngestionBinding";
