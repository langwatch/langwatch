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
 * The `topic_clustering` aggregate (ADR-105): one clustering stream per
 * project, `aggregateId = tenantId = projectId`, replacing the old
 * pipeline's `schemas/constants.ts` + `schemas/events.ts` + `commands.ts` —
 * four declaration sites collapsing to one.
 *
 * === This aggregate has no fold state of its own ===
 *
 * `state` here is deliberately inert (`z.object({}).strict()`, mirroring
 * `automations/aggregate.ts`'s `triggerAggregate`), because none of this
 * pipeline's THREE real read models — run status, run history, the topic
 * model (`projections/`) — is privileged as "the" aggregate state. Each is
 * an independent fold with its own state, store and version, per ADR-098
 * decision 1 ("production mounts 7 folds, 16 maps..." — one aggregate, many
 * folds). None of the five commands below needs to read state back to decide
 * what to emit either: every one of the old command handlers
 * (`event-sourcing.old/pipelines/topic-clustering-processing/commands.ts`)
 * was a pure input-to-event translator with no state-dependent refusal
 * logic, and this rewrite preserves that.
 *
 * === A discrepancy worth flagging (matching `log-processing/aggregate.ts`
 * and `automations/aggregate.ts`, the same finding independently) ===
 *
 * ADR-105 decision 1's own illustrative example declares an aggregate with a
 * `prefix` field and an `aggregateId` extractor built into a single object
 * literal. The actual shipped `defineAggregate`
 * (`packages/event-sourcing/src/aggregate/defineAggregate.ts`) has neither:
 * it is curried as `defineAggregate(name).state(...).events(...).commands(...)`,
 * the derived event type string is exactly `${name}/${key}` with no prefix,
 * and nothing in the package derives an aggregate id. This rewrite follows
 * the real, shipped API per this task's instruction to read `src/index.ts`
 * rather than the ADR's narrative example. Two consequences:
 *
 * 1. The persisted event type strings are `topic_clustering/requested`,
 *    `topic_clustering/runStarted`, etc. — not the old dotted
 *    `lw.obs.topic_clustering.requested`. This is the whole-ADR-series format
 *    change every converted aggregate makes, not something invented for this
 *    pipeline, and this rewrite does not attempt to bridge or migrate
 *    already-stored `lw.obs.topic_clustering.*` rows — a whole-system cutover
 *    decision outside one pipeline's scope.
 * 2. Aggregate-id derivation stays a small sibling function
 *    ({@link topicClusteringAggregateId}) rather than a declaration field —
 *    the same seam the old pipeline already had (`commands.ts`'s
 *    `aggregateId: (d) => String(d.tenantId)` on every `defineCommand` call),
 *    just not yet absorbed into `defineAggregate`.
 *
 * === Known gap — command-level idempotency (the defect this rewrite must
 * not reintroduce) ===
 *
 * `CommandDef.handle` in the shipped `@langwatch/event-sourcing`
 * (`aggregate.types.ts`) returns only `readonly EventUnion[]` — a bare
 * `{ type, data }` per event, with no channel for an idempotency key to
 * travel to whatever will eventually append these events to `event_log`.
 * This is the exact gap `automations/aggregate.ts` documents independently
 * for `triggerAggregate.recordMatch`, and it matters more here than almost
 * anywhere else in the codebase: `trace-processing/commands/assignTopicCommand.ts`
 * is the worked example of what happens without one. `AssignTopicCommand`
 * originally emitted its `TopicAssignedEvent` with no explicit
 * `idempotencyKey`, so `event_log`'s write path fell back to `event.id` — a
 * fresh KSUID per delivery — and a redelivered trace-topic assignment (a
 * clustering page re-run, or an outbox retry) never collapsed in
 * `event_log`'s `ReplacingMergeTree(...)` ordered by
 * `(TenantId, AggregateType, AggregateId, IdempotencyKey)`: a permanent
 * duplicate row, plus a redundant trace-fold pass, on every redelivery. It
 * has since been fixed by keying on the assignment's own identity —
 * `${tenantId}:${traceId}:topic:${topicId}:${subtopicId}`, deliberately
 * excluding `occurredAt` so re-asserting the same fact collapses while a
 * genuine re-topic still lands as its own event
 * (`assignTopicCommand.ts:67-72`, and the redelivery contract tests in
 * `commands/__tests__/assignTopicCommand.unit.test.ts`).
 *
 * `AssignTopicCommand` itself is out of scope for this rewrite: its
 * aggregate is `trace` (trace-processing's aggregate, a different pipeline
 * directory — "touch only your pipeline's directory"). But the lesson is not
 * out of scope, because every command below asserts a fact with exactly the
 * same redelivery exposure (a clustering page re-run, or a process-manager
 * outbox retry, can call any of these five commands again with the same
 * logical intent). Rather than inventing a substitute channel inside this
 * package — which this pipeline does not own — each command's natural key is
 * exported as a standalone pure function alongside it
 * ({@link requestClusteringIdempotencyKey} and its four siblings below), the
 * same resolution `automations/settleWindow.ts`'s `settleWindowBucket`
 * demonstrates, so a future command-dispatch layer has an exact, tested,
 * deterministic key to wire in without this pipeline guessing at that
 * layer's shape. Every key below is scoped to the assigned FACT (a run id,
 * a page, a phase, a dedupe key), never to `occurredAt` or any other
 * delivery-varying value — the same principle that made
 * `assignTopicCommand.ts`'s fix work — and, unlike the old
 * `defineCommand`-based keys, does not prefix `tenantId`: the aggregate
 * stream this key collapses within is already tenant- and aggregate-scoped
 * by `event_log`'s own sort key (`TenantId`, `AggregateId` precede
 * `IdempotencyKey`), so repeating it here would be redundant, not safer.
 */

const topicClusteringStateSchema = z.object({}).strict();

export const topicClustering = defineAggregate("topic_clustering")
  .state(topicClusteringStateSchema, () => ({}))
  .events({
    requested: {
      data: requestedDataSchema,
      // No accumulator on this aggregate — see the module docblock.
      apply: (state) => state,
    },
    runStarted: {
      data: runStartedDataSchema,
      apply: (state) => state,
    },
    runCompleted: {
      data: runCompletedDataSchema,
      apply: (state) => state,
    },
    runFailed: {
      data: runFailedDataSchema,
      apply: (state) => state,
    },
    topicsRecorded: {
      data: topicsRecordedDataSchema,
      apply: (state) => state,
    },
  })
  .commands({
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
  })
  .build();

export type TopicClusteringAggregate = typeof topicClustering;

/**
 * The event keys `topicClustering.events` declares — `keyof`, not a
 * hand-retyped string union. Every fold in `projections/` and the process
 * manager in `process-manager/schedule.ts` dispatch on this type (or a
 * `Pick` of it), never on a reconstructed `` `${topicClustering.name}/…` ``
 * literal — reconstructing the prefix by hand would duplicate the key
 * `.events({...})` above already owns, exactly the "hand-maintained
 * event-type map" this pipeline's declaration exists to make unnecessary
 * (ADR-105), and the mistake this rewrite made on its first pass: each
 * fold's event union originally spelled out
 * `AggregateEvent<"topic_clustering/requested", RequestedData>` by hand,
 * which would have silently gone stale the moment this aggregate's name or
 * an event key changed. See `experiment-run-processing/projection.ts`'s
 * `ExperimentRunEventKey`/`eventKeyOf` for the precedent this follows.
 */
export type TopicClusteringEventKey = keyof typeof topicClustering.events;

/**
 * Recovers the event key a fold or process-manager dispatch table is keyed
 * by from a delivered event's own `.type` string, stripping the
 * aggregate's own `name` rather than a hand-duplicated prefix literal.
 * Returns `undefined` for a type this aggregate does not declare — an
 * unrecognised event is a no-op for every consumer, mirroring
 * `Aggregate.apply`'s own tolerance of the same case.
 */
export function topicClusteringEventKeyOf(
  type: string,
): TopicClusteringEventKey | undefined {
  const prefix = `${topicClustering.name}/`;
  return type.startsWith(prefix)
    ? (type.slice(prefix.length) as TopicClusteringEventKey)
    : undefined;
}

/**
 * The aggregate id for a `topic_clustering` aggregate: the project itself —
 * one clustering stream per project, `TenantId = ProjectId`. Lives beside the
 * declaration rather than inside it; see the module docblock's discrepancy
 * note for why `defineAggregate` has no `.aggregateId()` step to hold this.
 */
export function topicClusteringAggregateId(data: { tenantId: string }): string {
  return data.tenantId;
}

// ---------------------------------------------------------------------------
// Command idempotency keys — see the module docblock's "Known gap" section.
// ---------------------------------------------------------------------------

/**
 * Bootstrap is once-per-project (re-sends collapse in the event log and are
 * harmless to the process); a manual request is its own ask each time,
 * identified by the instant it was accepted so a genuine second click still
 * gets its own event while a redelivery of the same click collapses.
 */
export function requestClusteringIdempotencyKey(
  data: Pick<RequestedData, "trigger" | "occurredAt">,
): string {
  return data.trigger === "bootstrap"
    ? "topic_clustering:bootstrap"
    : `topic_clustering:request:${data.occurredAt}`;
}

/** Keyed per page, so a redelivered intent re-announces the same page rather
 * than appending a second start for it. */
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

/** Keyed by the caller's own dedupe key (`run:<id>:page-<n>` / `seed:v1`),
 * not by content — two calls with the same key are the same fact even if a
 * transient field inside `topics` differs. */
export function recordTopicsIdempotencyKey(
  data: Pick<TopicsRecordedData, "dedupeKey">,
): string {
  return `topic_clustering:topics:${data.dedupeKey}`;
}
