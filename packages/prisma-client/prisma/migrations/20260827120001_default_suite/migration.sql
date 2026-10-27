-- Every scenario belongs to a test suite.
--
-- Before this migration a scenario could be loose: "Scenario"."folderId" null
-- and no suite listing it, so every surface that reads scenarios carried that
-- case. This migration removes the loose state from the data. Each project that
-- still holds an unfiled active scenario gets one folder-kind suite named
-- "Default", and every unfiled active scenario of that project is filed into it.
--
-- What this deliberately leaves alone:
--   * Archived scenarios. An archived scenario keeps whatever folder it had, so
--     a later restore can put it back, and it is not a member while archived.
--   * Projects with nothing to file. A project with no scenario, or one that
--     already filed all of them, gets no suite. Default is a migration artifact,
--     not an onboarding one: a new project names its own first suite.
--   * Projects that already own a folder named "Default". Their unfiled
--     scenarios are filed into that folder instead of a second one.
--
-- "Scenario"."folderId" stays nullable on purpose. What keeps a newly written
-- scenario out of the loose state is the service (ScenarioService.create files
-- into Default when the caller names no suite), not a NOT NULL constraint,
-- because an archived scenario and a code-pushed scenario both legitimately
-- carry no folder.
--
-- IRREVERSIBLE: there is no down migration.
--
-- After this runs, "Scenario"."folderId" no longer records which scenarios were
-- unfiled before it, so a revert cannot tell a scenario the migration filed
-- from one a person filed. Reverting means deciding, per project, what the
-- Default suite should become, which is a data decision and not a schema one.

-- Step 1: one "Default" folder for each project that needs one.
--
-- The slug shares the per-project suite slug namespace, so a project whose
-- "default" slug is already taken gets a slug suffixed from the new row's own
-- id, which is unique by construction.
WITH targets AS (
  SELECT DISTINCT s."projectId" AS project_id
  FROM "Scenario" s
  WHERE s."folderId" IS NULL
    AND s."archivedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "SimulationSuite" existing
      WHERE existing."projectId" = s."projectId"
        AND existing."kind" = 'folder'
        AND existing."archivedAt" IS NULL
        AND lower(btrim(existing."name")) = 'default'
    )
),
new_rows AS (
  SELECT
    t.project_id,
    'suite_' || replace(gen_random_uuid()::text, '-', '') AS new_id
  FROM targets t
)
INSERT INTO "SimulationSuite" (
  "id",
  "projectId",
  "name",
  "slug",
  "scenarioIds",
  "targets",
  "repeatCount",
  "labels",
  "kind",
  "createdAt",
  "updatedAt"
)
SELECT
  n.new_id,
  n.project_id,
  'Default',
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM "SimulationSuite" taken
      WHERE taken."projectId" = n.project_id
        AND taken."slug" = 'default'
    ) THEN 'default-' || right(n.new_id, 8)
    ELSE 'default'
  END,
  ARRAY[]::TEXT[],
  '[]'::JSONB,
  1,
  ARRAY[]::TEXT[],
  'folder',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM new_rows n;

-- Step 2: file every unfiled active scenario into its project's Default folder.
--
-- DISTINCT ON picks one folder per project, so a project that already held two
-- folders both named "Default" files everything into the older of the two
-- rather than splitting them.
WITH default_folder AS (
  SELECT DISTINCT ON (folder."projectId")
    folder."projectId" AS project_id,
    folder."id" AS folder_id
  FROM "SimulationSuite" folder
  WHERE folder."kind" = 'folder'
    AND folder."archivedAt" IS NULL
    AND lower(btrim(folder."name")) = 'default'
  ORDER BY folder."projectId", folder."createdAt" ASC, folder."id" ASC
)
UPDATE "Scenario" s
SET "folderId" = d.folder_id
FROM default_folder d
WHERE d.project_id = s."projectId"
  AND s."folderId" IS NULL
  AND s."archivedAt" IS NULL;

-- Step 3: rebuild the member cache of every folder.
--
-- "SimulationSuite"."scenarioIds" is a copy of the scenarios that name the
-- folder, kept in step by reconcileFolderMembership. The same rule is applied
-- here: active members only, ordered by "createdAt" ascending. Archived folders
-- are skipped because their list is a snapshot a restore reads.
WITH members AS (
  SELECT
    s."folderId" AS folder_id,
    array_agg(s."id" ORDER BY s."createdAt" ASC) AS scenario_ids
  FROM "Scenario" s
  WHERE s."folderId" IS NOT NULL
    AND s."archivedAt" IS NULL
  GROUP BY s."folderId"
)
UPDATE "SimulationSuite" folder
SET "scenarioIds" = m.scenario_ids
FROM members m
WHERE folder."id" = m.folder_id
  AND folder."kind" = 'folder'
  AND folder."archivedAt" IS NULL;
