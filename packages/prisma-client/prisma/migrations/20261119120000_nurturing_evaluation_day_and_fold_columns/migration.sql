-- Nurturing's projections replace its subscriber-written copies (build plan, commit 2):
--
--   * "NurturingOrganization"."adminAt": the stamp of the fact that named the admin, so a
--     projection keeps the latest-stamped admin whatever order facts arrive in.
--   * "NurturingOrganizationPlan"."appliedEventIds" and "winnerEventId": the plan peer fold's
--     delivery dedupe and the id of the fact that last changed the row (the one allowed to send).
--   * "NurturingProjectEvaluationDay": one row per project and UTC day with an evaluation, written
--     insert-ignore from evaluation's lifecycle_completed. It replaces the `evaluation` rows of
--     "NurturingProjectUsageView", which held the same days inside `folded`.
--
-- The days already held by `evaluation` usage rows are copied into the new table, one row per
-- entry of `folded.activeDays`. Nothing is updated or deleted: the old `evaluation` rows stay,
-- unread; removing them is a named operator step.
--
-- Expand only: new nullable or defaulted columns and a new table. Nothing is dropped.
-- No foreign key, as for NurturingProjectTraceDay.
--
-- Spec: enterprise/modules/nurturing/specs/project-usage.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP TABLE "NurturingProjectEvaluationDay";
--   ALTER TABLE "NurturingOrganizationPlan" DROP COLUMN "winnerEventId", DROP COLUMN "appliedEventIds";
--   ALTER TABLE "NurturingOrganization" DROP COLUMN "adminAt";

ALTER TABLE "NurturingOrganization" ADD COLUMN IF NOT EXISTS "adminAt" TIMESTAMP(3);

ALTER TABLE "NurturingOrganizationPlan" ADD COLUMN IF NOT EXISTS "appliedEventIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN IF NOT EXISTS "winnerEventId" TEXT;

CREATE TABLE IF NOT EXISTS "NurturingProjectEvaluationDay" (
    "projectId" TEXT NOT NULL,
    "day" TEXT NOT NULL,

    CONSTRAINT "NurturingProjectEvaluationDay_pkey" PRIMARY KEY ("projectId", "day")
);

INSERT INTO "NurturingProjectEvaluationDay" ("projectId", "day")
SELECT usage."projectId", days.day
FROM "NurturingProjectUsageView" AS usage
CROSS JOIN LATERAL jsonb_array_elements_text(usage."folded" -> 'activeDays') AS days(day)
WHERE usage."owner" = 'evaluation'
  AND jsonb_typeof(usage."folded" -> 'activeDays') = 'array'
ON CONFLICT DO NOTHING;
