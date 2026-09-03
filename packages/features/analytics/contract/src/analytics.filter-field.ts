import { z } from "zod";

/**
 * Every field an analytics filter may name.
 *
 * Published here because the ClickHouse filter translator needs it to be
 * EXHAUSTIVE. Its handler table is a `Record<FilterField, …>`, so a field added
 * to this enum without a handler fails to compile — which is the only thing
 * standing between a new filter and a query that silently ignores it.
 *
 * The translator lost that when it moved into the feature package: the type
 * lived in `platform/app/src/server/filters/types.ts`, out of reach, so the
 * table was widened to `Record<string, …>` and the guarantee went with it.
 */
export const filterFieldsEnum = z.enum([
  "topics.topics",
  "topics.subtopics",
  "metadata.user_id",
  "metadata.thread_id",
  "metadata.customer_id",
  "metadata.labels",
  "metadata.key",
  "metadata.value",
  "metadata.prompt_ids",
  "traces.origin",
  "traces.error",
  "traces.name",
  "spans.type",
  "spans.model",
  "evaluations.evaluator_id",
  "evaluations.evaluator_id.guardrails_only",
  "evaluations.evaluator_id.has_passed",
  "evaluations.evaluator_id.has_score",
  "evaluations.evaluator_id.has_label",
  "evaluations.passed",
  "evaluations.score",
  "evaluations.state",
  "evaluations.label",
  "events.event_type",
  "events.metrics.key",
  "events.metrics.value",
  "events.event_details.key",
  "annotations.hasAnnotation",
]);

export type FilterField = z.infer<typeof filterFieldsEnum>;
