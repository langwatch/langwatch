/**
 * The changes a board marks on its time axis: a prompt version saved, or a model that
 * carried no traffic in the 30 days before it first did. LangWatch records no deploys.
 */

import { bucketOf, END, inPeriod, START } from "../../templates/model/lwql-period.ts";

/** How far back a model must have been silent for its first call to count as a change. */
const NEW_MODEL_LOOKBACK_DAYS = 30;

const MODEL_WINDOW = `BucketStart >= subtractDays(${START}, ${NEW_MODEL_LOOKBACK_DAYS})
    AND BucketStart < ${END}
    AND Model != ''`;

// A model is new only once some other model ran a day before it, so the day a
// project starts sending traffic is not marked as a change.
const NEW_MODELS = `SELECT Model, min(BucketStart) AS first_seen
  FROM model_usage_by_minute
  WHERE ${MODEL_WINDOW}
  GROUP BY Model
  HAVING first_seen >= ${START}
    AND first_seen >= addDays((SELECT min(BucketStart) FROM model_usage_by_minute
      WHERE ${MODEL_WINDOW}), 1)`;

/** Every change in the period, unordered, with the bucket a chart marks it on. */
export const CHANGES_SQL = `SELECT ${bucketOf("v.CreatedAt")} AS bucket, toDateTime(v.CreatedAt) AS at,
  concat(p.PromptHandle, ' v', toString(v.VersionNumber)) AS label
FROM prompt_versions AS v
INNER JOIN prompts AS p ON p.PromptId = v.PromptId
WHERE ${inPeriod("v.CreatedAt")}
LIMIT 50
UNION ALL
SELECT ${bucketOf("first_seen")} AS bucket, toDateTime(first_seen) AS at,
  concat('model ', Model) AS label
FROM (${NEW_MODELS})
LIMIT 50`;

/** The moment of the newest change in the period; the epoch when there was none. */
export const LAST_CHANGE_AT = `greatest(
  (SELECT toDateTime(max(CreatedAt)) FROM prompt_versions WHERE ${inPeriod("CreatedAt")}),
  (SELECT toDateTime(max(first_seen)) FROM (${NEW_MODELS})))`;
