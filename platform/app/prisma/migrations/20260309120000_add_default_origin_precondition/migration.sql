-- Add default origin=application precondition to ALL existing monitors.
-- Monitors with empty preconditions ([], {}, or null) get the default only.
-- Monitors with existing preconditions get the origin default prepended.

-- Step 1: Monitors with empty array [] or empty object {} or null
-- → Set to the default origin precondition
UPDATE "Monitor"
SET "preconditions" = '[{"field":"traces.origin","rule":"is","value":"application"}]'::jsonb
WHERE "preconditions" IS NULL
   OR "preconditions"::text = 'null'
   OR "preconditions"::text = '[]'
   OR "preconditions"::text = '{}';

-- Step 2: Monitors with existing non-empty preconditions (JSON array with items)
-- → Prepend the origin default to the beginning of the array
UPDATE "Monitor"
SET "preconditions" = (
  '[{"field":"traces.origin","rule":"is","value":"application"}]'::jsonb || "preconditions"::jsonb
)
WHERE "preconditions" IS NOT NULL
  AND "preconditions"::text != '[]'
  AND "preconditions"::text != '{}'
  AND jsonb_typeof("preconditions"::jsonb) = 'array'
  AND jsonb_array_length("preconditions"::jsonb) > 0
  -- Don't add if origin precondition already exists
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements("preconditions"::jsonb) AS elem
    WHERE elem->>'field' = 'traces.origin'
  );
