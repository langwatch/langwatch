UPDATE "Dataset"
SET "columnTypes" = (
    SELECT json_agg(json_build_object('name', key, 'type', value))
    FROM json_each_text("columnTypes"::json)
);