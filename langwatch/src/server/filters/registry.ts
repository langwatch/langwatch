import type { FilterDefinition, FilterField } from "@langwatch/contracts/filters";

/**
 * UI metadata for every filter field: display name, URL key, and key/subkey
 * requirements. The actual filter-option queries live in
 * `./clickhouse/filter-definitions.ts`; trace filtering conditions live in
 * `./clickhouse/filter-conditions.ts`.
 */
export const availableFilters: { [K in FilterField]: FilterDefinition } = {
  "topics.topics": {
    name: "Topic",
    urlKey: "topics",
  },
  "topics.subtopics": {
    name: "Subtopic",
    urlKey: "subtopics",
  },
  "metadata.user_id": {
    name: "User ID",
    urlKey: "user_id",
  },
  "metadata.thread_id": {
    name: "Thread ID",
    urlKey: "thread_id",
  },
  "metadata.customer_id": {
    name: "Customer ID",
    urlKey: "customer_id",
  },
  "metadata.labels": {
    name: "Label",
    urlKey: "labels",
  },
  "metadata.key": {
    name: "Metadata Key",
    urlKey: "metadata_key",
    single: true,
  },
  "metadata.value": {
    name: "Metadata",
    urlKey: "metadata",
    single: true,
    requiresKey: {
      filter: "metadata.key",
    },
  },
  "traces.origin": {
    name: "Origin",
    urlKey: "origin",
  },
  "traces.error": {
    name: "Contains Error",
    urlKey: "has_error",
  },
  "traces.name": {
    name: "Trace Name",
    urlKey: "trace_name",
  },
  "spans.type": {
    name: "Span Type",
    urlKey: "span_type",
  },
  "spans.model": {
    name: "Model",
    urlKey: "model",
  },
  "evaluations.evaluator_id": {
    name: "Contains Evaluation",
    urlKey: "evaluator_id",
  },
  "evaluations.evaluator_id.guardrails_only": {
    name: "Contains Evaluation (guardrails only)",
    urlKey: "guardrail_evaluator_id",
  },
  "evaluations.evaluator_id.has_passed": {
    name: "Evaluators with Passed results",
    urlKey: "evaluator_id_has_passed",
  },
  "evaluations.evaluator_id.has_score": {
    name: "Evaluators with Score results",
    urlKey: "evaluator_id_has_score",
  },
  "evaluations.evaluator_id.has_label": {
    name: "Evaluators with Label results",
    urlKey: "evaluator_id_has_label",
  },
  "evaluations.passed": {
    name: "Evaluation Passed",
    urlKey: "evaluation_passed",
    single: true,
    requiresKey: {
      filter: "evaluations.evaluator_id.has_passed",
    },
  },
  "evaluations.score": {
    name: "Evaluation Score",
    urlKey: "evaluation_score",
    type: "numeric",
    single: true,
    requiresKey: {
      filter: "evaluations.evaluator_id.has_score",
    },
  },
  "evaluations.label": {
    name: "Evaluation Label",
    urlKey: "evaluation_label",
    requiresKey: {
      filter: "evaluations.evaluator_id.has_label",
    },
  },
  "evaluations.state": {
    name: "Evaluation Execution State",
    urlKey: "evaluation_run",
    requiresKey: {
      filter: "evaluations.evaluator_id",
    },
  },
  "events.event_type": {
    name: "Event",
    urlKey: "event_type",
    single: true,
  },
  "events.metrics.key": {
    name: "Metric",
    urlKey: "event_metric",
    single: true,
    requiresKey: {
      filter: "events.event_type",
    },
  },
  "events.metrics.value": {
    name: "Event Metric",
    urlKey: "event_metric_value",
    single: true,
    type: "numeric",
    requiresKey: {
      filter: "events.event_type",
    },
    requiresSubkey: {
      filter: "events.metrics.key",
    },
  },
  "events.event_details.key": {
    name: "Event Detail",
    urlKey: "event_detail",
    requiresKey: {
      filter: "events.event_type",
    },
  },
  "annotations.hasAnnotation": {
    name: "Annotations",
    urlKey: "annotations",
  },
  "metadata.prompt_ids": {
    name: "Prompt ID",
    urlKey: "prompt_id",
  },
};
