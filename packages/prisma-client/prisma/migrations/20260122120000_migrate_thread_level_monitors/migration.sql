-- Migrate existing monitors with thread mappings to have level = 'thread'
-- This updates monitors where any mapping has type = 'thread' in the JSON

UPDATE "Monitor"
SET "level" = 'thread'
WHERE "mappings" IS NOT NULL
  AND "mappings"::text LIKE '%"type":"thread"%';
