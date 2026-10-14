-- Unwrap Trigger.filters / Trigger.actionParams values that an earlier release
-- stored as a JSON-encoded string (jsonb_typeof = 'string') instead of an object.
-- The app now tolerates both shapes on read; this normalises the data in place.
--
-- `IS JSON OBJECT` needs Postgres 16, so the parse is guarded with an exception
-- handler instead. Rows that are not strings holding an object are left untouched.
-- A no-op on databases that were already fixed (no row matches).

CREATE FUNCTION pg_temp.lw_unwrap_json_object(value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  parsed jsonb;
BEGIN
  parsed := (value #>> '{}')::jsonb;
  IF jsonb_typeof(parsed) = 'object' THEN
    RETURN parsed;
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

UPDATE "Trigger"
SET "filters" = pg_temp.lw_unwrap_json_object("filters")
WHERE jsonb_typeof("filters") = 'string'
  AND pg_temp.lw_unwrap_json_object("filters") IS NOT NULL;

UPDATE "Trigger"
SET "actionParams" = pg_temp.lw_unwrap_json_object("actionParams")
WHERE jsonb_typeof("actionParams") = 'string'
  AND pg_temp.lw_unwrap_json_object("actionParams") IS NOT NULL;
