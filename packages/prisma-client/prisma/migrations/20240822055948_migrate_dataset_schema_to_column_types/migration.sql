-- Step 1: Add the new columnTypes JSONB column
ALTER TABLE "Dataset" ADD COLUMN "columnTypes" JSONB;

-- Step 2: Update the columnTypes based on the existing columns
UPDATE "Dataset"
SET "columnTypes" = (
  SELECT jsonb_object_agg(
    column_name,
    CASE
      WHEN column_name = 'id' THEN 'string'
      WHEN column_name = 'input' THEN 'string'
      WHEN column_name = 'expected_output' THEN 'string'
      WHEN column_name = 'spans' THEN 'spans'
      WHEN column_name = 'contexts' THEN 'rag_contexts'
      WHEN column_name = 'comments' THEN 'string'
      WHEN column_name = 'annotation_scores' THEN 'annotations'
      WHEN column_name = 'evaluations' THEN 'evaluations'
      WHEN column_name = 'llm_input' THEN 'chat_messages'
      WHEN column_name = 'expected_llm_output' THEN 'chat_messages'
      ELSE 'string' -- Default to 'string' for any unspecified columns
    END
  )
  FROM unnest(string_to_array("columns", ',')) AS column_name
);

-- Step 3: Make columnTypes NOT NULL
ALTER TABLE "Dataset" ALTER COLUMN "columnTypes" SET NOT NULL;

-- Step 4: Drop the old columns
ALTER TABLE "Dataset" DROP COLUMN "columns",
                      DROP COLUMN "schema";

-- Step 5: Drop the enum if it's no longer needed
DROP TYPE "DatabaseSchema";
