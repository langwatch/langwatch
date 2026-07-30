import { defineAggregate } from "@langwatch/event-sourcing";
import { z } from "zod";
import {
  type RequestedData,
  type RunCompletedData,
  type RunFailedData,
  type RunStartedData,
  requestedDataSchema,
  runCompletedDataSchema,
  runFailedDataSchema,
  runStartedDataSchema,
  type TopicsRecordedData,
  topicsRecordedDataSchema,
} from "./schema";

/**
 * The `topic_clustering` aggregate: one clustering stream per project.
 *
 * It carries no accumulator of its own. The three read models this pipeline
 * serves — run status, run history, the topic model — are independent folds
 * with their own state, store and version, and none of them is privileged as
 * "the" aggregate state (ADR-098).
 */
export const topicClustering = defineAggregate({
  name: "topic_clustering",
  // `lw.obs.topic_clustering.*` is already in `event_log`; the prefix is what
  // keeps the derived strings equal to it.
  prefix: "lw.obs",
  state: z.object({}).strict(),
  init: () => ({}),
  id: (data) => data.projectId,
  events: {
    requested: { data: requestedDataSchema, apply: (state) => state },
    runStarted: { data: runStartedDataSchema, apply: (state) => state },
    runCompleted: { data: runCompletedDataSchema, apply: (state) => state },
    runFailed: { data: runFailedDataSchema, apply: (state) => state },
    topicsRecorded: {
      data: topicsRecordedDataSchema,
      apply: (state) => state,
    },
  },
  commands: {
    requestClustering: {
      input: requestedDataSchema,
      handle: (_state, input, events) => [events.requested(input)],
    },
    recordClusteringRunStarted: {
      input: runStartedDataSchema,
      handle: (_state, input, events) => [events.runStarted(input)],
    },
    recordClusteringRunCompleted: {
      input: runCompletedDataSchema,
      handle: (_state, input, events) => [events.runCompleted(input)],
    },
    recordClusteringRunFailed: {
      input: runFailedDataSchema,
      handle: (_state, input, events) => [events.runFailed(input)],
    },
    recordTopics: {
      input: topicsRecordedDataSchema,
      handle: (_state, input, events) => [events.topicsRecorded(input)],
    },
  },
});

export type TopicClusteringAggregate = typeof topicClustering;

/**
 * The natural key each command's event collapses on in `event_log`. Scoped to
 * the fact being asserted — a run's page, a dedupe key — never to a
 * delivery-varying value, so a redelivery collapses while a genuinely new
 * assertion still lands. No `tenantId` prefix: `event_log`'s sort key already
 * scopes an idempotency key by tenant and aggregate.
 */
export function requestClusteringIdempotencyKey(
  data: Pick<RequestedData, "trigger" | "occurredAt">,
): string {
  // Bootstrap is once per project; a manual ask is its own each time, so it is
  // identified by the instant it was accepted.
  return data.trigger === "bootstrap"
    ? "topic_clustering:bootstrap"
    : `topic_clustering:request:${data.occurredAt}`;
}

export function recordClusteringRunStartedIdempotencyKey(
  data: Pick<RunStartedData, "runId" | "page">,
): string {
  return `topic_clustering:${data.runId}:page-${data.page}:started`;
}

export function recordClusteringRunCompletedIdempotencyKey(
  data: Pick<RunCompletedData, "runId" | "page">,
): string {
  return `topic_clustering:${data.runId}:page-${data.page}:completed`;
}

export function recordClusteringRunFailedIdempotencyKey(
  data: Pick<RunFailedData, "runId" | "page">,
): string {
  return `topic_clustering:${data.runId}:page-${data.page}:failed`;
}

export function recordTopicsIdempotencyKey(
  data: Pick<TopicsRecordedData, "dedupeKey">,
): string {
  return `topic_clustering:topics:${data.dedupeKey}`;
}
