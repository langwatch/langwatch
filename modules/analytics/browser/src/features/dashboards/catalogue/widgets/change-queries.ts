/**
 * The changes a board marks on its time axis: a release (a new application version), a prompt
 * version saved, or a model that carried no traffic in the 30 days before it first did.
 * @see specs/lwql/release-check-reads-releases.feature
 */

import { bucketOf, END, inPeriod, START } from "../../templates/model/lwql-period.ts";

/** How long a model or version must have been silent for its first trace to count as a change. */
const NEW_MODEL_LOOKBACK_DAYS = 30;

// trace_metrics, not the per-minute rollup: the rollup keeps no origin, so a model only Langy or
// a simulation ran would read as a change to production. Here the widget's sources apply.
const MODEL_WINDOW = `OccurredAt >= subtractDays(${START}, ${NEW_MODEL_LOOKBACK_DAYS})
      AND OccurredAt < ${END}
      AND notEmpty(Models)`;

// A model is new only once some other model ran a day before it, so the day a
// project starts sending traffic is not marked as a change.
const NEW_MODELS = `SELECT ChangedModel, min(OccurredAt) AS first_seen
  FROM (SELECT arrayJoin(Models) AS ChangedModel, OccurredAt
    FROM trace_metrics
    WHERE ${MODEL_WINDOW})
  WHERE ChangedModel != ''
  GROUP BY ChangedModel
  HAVING first_seen >= ${START}
    AND first_seen >= addDays((SELECT min(OccurredAt) FROM trace_metrics
      WHERE ${MODEL_WINDOW}), 1)`;

const VERSION_WINDOW = `OccurredAt >= subtractDays(${START}, ${NEW_MODEL_LOOKBACK_DAYS})
      AND OccurredAt < ${END}
      AND AppVersion != ''`;

// A release is the first trace of an application version (service.version, else
// metadata.version). Only the version(s) the window starts with are no release: any later
// one is, even hours after the project's first trace.
const NEW_RELEASES = `SELECT AppVersion AS ReleasedVersion, min(OccurredAt) AS first_seen
  FROM trace_metrics
  WHERE ${VERSION_WINDOW}
  GROUP BY ReleasedVersion
  HAVING first_seen >= ${START}
    AND first_seen > (SELECT min(OccurredAt) FROM trace_metrics
      WHERE ${VERSION_WINDOW})`;

/** Every change in the period, unordered, with the bucket a chart marks it on. */
export const CHANGES_SQL = `SELECT ${bucketOf("v.CreatedAt")} AS bucket, toDateTime(v.CreatedAt) AS at,
  concat('Prompt ', p.PromptHandle, ' v', toString(v.VersionNumber)) AS label
FROM prompt_versions AS v
INNER JOIN prompts AS p ON p.PromptId = v.PromptId
WHERE ${inPeriod("v.CreatedAt")}
LIMIT 50
UNION ALL
SELECT ${bucketOf("first_seen")} AS bucket, toDateTime(first_seen) AS at,
  concat('Model: ', ChangedModel) AS label
FROM (${NEW_MODELS})
LIMIT 50
UNION ALL
SELECT ${bucketOf("first_seen")} AS bucket, toDateTime(first_seen) AS at,
  concat('Release ', ReleasedVersion) AS label
FROM (${NEW_RELEASES})
LIMIT 50`;

/**
 * The name a person knows each managed prompt version by, "handle vN", keyed by the version id
 * a trace stores; newest first, so a widget names the versions it marks.
 */
export const PROMPT_VERSION_NAMES_SQL = `SELECT v.PromptVersionId AS id,
  concat(p.PromptHandle, ' v', toString(v.VersionNumber)) AS name
FROM prompt_versions AS v
INNER JOIN prompts AS p ON p.PromptId = v.PromptId
ORDER BY v.CreatedAt DESC
LIMIT 500`;

/** The moment of the newest change in the period; the epoch when there was none. */
export const LAST_CHANGE_AT = `greatest(
  (SELECT toDateTime(max(CreatedAt)) FROM prompt_versions WHERE ${inPeriod("CreatedAt")}),
  (SELECT toDateTime(max(first_seen)) FROM (${NEW_MODELS})),
  (SELECT toDateTime(max(first_seen)) FROM (${NEW_RELEASES})))`;
