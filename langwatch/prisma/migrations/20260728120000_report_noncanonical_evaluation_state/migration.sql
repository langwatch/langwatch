-- Report-only detection for #4805 / #6296: an automation (`"Trigger"` row)
-- can hold an `evaluations.state` filter value that is not one of the five
-- canonical `EvaluationRunData.status` values (`scheduled`, `in_progress`,
-- `processed`, `error`, `skipped`). A value outside that domain can never
-- match, so the automation sits enabled and silently never notifies. See
-- specs/automations/evaluation-state-filter-repair.feature, Rule "A value
-- that cannot be confidently repaired is reported, never guessed".
--
-- This migration is report-only by design: mapping a phantom value like
-- `Error_Message` to `error` is only safe with evidence this codebase does
-- not have access to (see AC5b in the feature file above), and a wrong
-- mapping turns a silently-dead automation into an alert storm. So this
-- file only ever WRITES to the new "TriggerFilterFinding" sidecar table
-- below. It never UPDATEs, DELETEs, or otherwise mutates a single
-- "Trigger" row -- it only ever SELECTs from it.
--
-- The table has no schema.prisma model, following the ReactorOutbox
-- precedent (20260703120000_add_reactor_outbox): this is operator/analysis
-- tooling, not part of the application's runtime data model.
--
-- The trap this migration exists to avoid: "filters" is a jsonb column,
-- but every write path calls JSON.stringify() before Prisma (see
-- src/app/api/triggers/[[...route]]/app.ts:66-74 and
-- trigger.prisma.repository.ts:333-345), so rows exist in two shapes -- a
-- jsonb OBJECT (older rows) and a jsonb STRING holding serialized JSON
-- text (rows written by current code). A naive `filters ? 'evaluations.state'`
-- is false for every string-shaped row, silently returning zero rows on
-- exactly the data that matters. Every scan below normalizes through both
-- shapes before it ever asks "does this hold evaluations.state".

-- CreateTable
CREATE TABLE IF NOT EXISTS "TriggerFilterFinding" (
    "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "triggerId"      TEXT NOT NULL,
    "projectId"      TEXT NOT NULL,
    "shape"          TEXT NOT NULL,
    "evaluatorKey"   TEXT,
    "offendingValue" TEXT,
    "rawFilters"     TEXT,
    "action"         TEXT NOT NULL,
    "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "TriggerFilterFinding_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TriggerFilterFinding_triggerId_idx" ON "TriggerFilterFinding"("triggerId");

-- Exception-safe inner JSON parse. "filters" being a jsonb COLUMN means the
-- OUTER value can never be malformed at rest -- Postgres would have
-- rejected the write. But the inner text of a jsonb-STRING row is
-- untrusted: it is whatever the application's own JSON.stringify() (or,
-- for a pre-migration row, something else entirely) produced, and a plain
-- `::jsonb` cast on unparseable text raises "invalid input syntax for
-- type json", aborting the ENTIRE statement the instant one row's inner
-- text fails to parse. This function makes that cast total instead of
-- partial. Postgres 16 (this project's pinned version) has no built-in
-- try-cast for jsonb -- that only arrived with the SQL/JSON `IS JSON`
-- predicate in Postgres 17 -- so the standard, portable way to get one is
-- this catch-and-return-NULL wrapper. It is scoped to this migration only
-- and dropped at the very end, once both scans below are done with it. A
-- normal (non-temp, non-`pg_temp`) function is used deliberately: it must
-- stay visible to whichever physical connection runs each statement below.
CREATE OR REPLACE FUNCTION _tff_try_parse_jsonb(input text)
RETURNS jsonb
LANGUAGE plpgsql
AS $tff$
BEGIN
  RETURN input::jsonb;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$tff$;

-- Insert 1 of 2: one row per (triggerId, evaluatorKey, offendingValue)
-- where the normalized evaluations.state object holds a value outside the
-- canonical five. Skips deleted triggers and triggers with no
-- evaluations.state key entirely -- a trigger with zero findings gets no
-- row here at all ("inspected" is not a recorded state).
--
-- The `normalized` CTE below mirrors the shape this repo's own domain
-- check walks in TypeScript (findOffendingEvaluationStateEntries,
-- src/server/filters/types.ts): a non-object evaluations.state value, or a
-- non-array per-evaluator value, contributes nothing -- never an error.
--
-- The `left(..., 1) = '{'` guard is load-bearing, not a style choice:
-- Postgres does not reliably short-circuit evaluation order, so an
-- unguarded `(text)::jsonb` attempt on every jsonb-string row --
-- including ones that were never meant to hold an object, like a plain
-- "true" or "42" -- risks the same abort this migration exists to avoid.
-- Cheaply ruling those out first, then routing only the plausible
-- remainder through the exception-safe parse above, is what keeps this a
-- single statement instead of a per-row procedure.
WITH normalized AS (
  SELECT
    t."id"        AS trigger_id,
    t."projectId" AS project_id,
    COALESCE(jsonb_typeof(t."filters"), 'unknown') AS shape,
    CASE
      WHEN jsonb_typeof(t."filters") = 'object' THEN t."filters"
      WHEN jsonb_typeof(t."filters") = 'string'
           AND left(t."filters" #>> '{}', 1) = '{'
        THEN _tff_try_parse_jsonb(t."filters" #>> '{}')
      ELSE NULL
    END AS object_filters
  FROM "Trigger" t
  WHERE t."deleted" = false
),
offending AS (
  SELECT DISTINCT
    n.trigger_id,
    n.project_id,
    n.shape,
    kv.key AS evaluator_key,
    (elem.value #>> '{}') AS offending_value
  FROM normalized n
  CROSS JOIN LATERAL jsonb_each(
    CASE
      WHEN jsonb_typeof(n.object_filters -> 'evaluations.state') = 'object'
        THEN n.object_filters -> 'evaluations.state'
      ELSE '{}'::jsonb
    END
  ) AS kv(key, value)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(kv.value) = 'array' THEN kv.value ELSE '[]'::jsonb END
  ) AS elem(value)
  WHERE n.object_filters IS NOT NULL
    AND jsonb_typeof(n.object_filters) = 'object'
    -- Exact key match only -- never a prefix/startsWith("evaluations.")
    -- check -- so evaluations.label and every other filter field are left
    -- alone even when they hold the same offending-shaped string.
    AND n.object_filters ? 'evaluations.state'
    AND jsonb_typeof(elem.value) = 'string'
    AND (elem.value #>> '{}') NOT IN ('scheduled', 'in_progress', 'processed', 'error', 'skipped')
)
INSERT INTO "TriggerFilterFinding"
  ("triggerId", "projectId", "shape", "evaluatorKey", "offendingValue", "rawFilters", "action")
SELECT
  o.trigger_id,
  o.project_id,
  o.shape,
  o.evaluator_key,
  o.offending_value,
  NULL,
  'reported_unmappable'
FROM offending o
WHERE NOT EXISTS (
  SELECT 1 FROM "TriggerFilterFinding" f
  WHERE f."triggerId" = o.trigger_id
    AND f."action" = 'reported_unmappable'
    AND f."evaluatorKey" = o.evaluator_key
    AND f."offendingValue" = o.offending_value
);

-- Insert 2 of 2: one row per trigger whose filters cannot be normalized to
-- an object at all -- a jsonb string whose inner text does not parse, a
-- jsonb string parsing to a non-object, or a top-level non-object. Never
-- touches evaluatorKey/offendingValue (there is no per-evaluator reading
-- to report); rawFilters carries the raw stored value so an operator can
-- see what they are looking at.
--
-- Repeats the `normalized` CTE from Insert 1 rather than sharing a scratch
-- table across statements: each INSERT here is a fully independent SQL
-- statement, and a temp table (or a `pg_temp` function) is only visible on
-- the physical connection that created it -- a real risk when a test (or
-- an operator) replays these statements one at a time rather than inside
-- one transaction. Repeating a ~15-line CTE avoids depending on that.
WITH normalized AS (
  SELECT
    t."id"        AS trigger_id,
    t."projectId" AS project_id,
    t."filters"   AS raw_filters,
    COALESCE(jsonb_typeof(t."filters"), 'unknown') AS shape,
    CASE
      WHEN jsonb_typeof(t."filters") = 'object' THEN t."filters"
      WHEN jsonb_typeof(t."filters") = 'string'
           AND left(t."filters" #>> '{}', 1) = '{'
        THEN _tff_try_parse_jsonb(t."filters" #>> '{}')
      ELSE NULL
    END AS object_filters
  FROM "Trigger" t
  WHERE t."deleted" = false
)
INSERT INTO "TriggerFilterFinding"
  ("triggerId", "projectId", "shape", "evaluatorKey", "offendingValue", "rawFilters", "action")
SELECT
  n.trigger_id,
  n.project_id,
  n.shape,
  NULL,
  NULL,
  (n.raw_filters::text),
  'reported_malformed'
FROM normalized n
WHERE (n.object_filters IS NULL OR jsonb_typeof(n.object_filters) <> 'object')
  AND NOT EXISTS (
    SELECT 1 FROM "TriggerFilterFinding" f
    WHERE f."triggerId" = n.trigger_id
      AND f."action" = 'reported_malformed'
  );

-- Cleanup: the exception-safe helper is scoped to this migration only.
DROP FUNCTION IF EXISTS _tff_try_parse_jsonb(text);

-- To roll back, uncomment and run manually:
-- DROP TABLE "TriggerFilterFinding";
