import { defineAggregate } from "@langwatch/event-sourcing";
import { type CanonicalLogRecord, canonicalLogRecordSchema } from "./schema";

/**
 * The `log` aggregate (ADR-105): one declaration replaces the old pipeline's
 * `schemas/constants.ts` + `schemas/events.ts` + `schemas/commands.ts` +
 * `commands/recordCanonicalLogCommand.ts` — the type string, the payload
 * type, the event union, the router's `eventTypes` list and the typed
 * creator are all derived from this, not authored four times over.
 *
 * A log record has no lifecycle (the old pipeline's README: "Nothing about it
 * changes after it arrives, so there is no state to fold and no reason to
 * pay for one"). So "state" here is deliberately the thinnest honest model of
 * that fact: null until the one event that will ever exist for this
 * aggregate arrives, and the record itself from then on. Nothing reads this
 * state back through a `ReplaceStore` — `projection.ts` mounts a *map*, which
 * never folds — so `stateVersion`/`schemaHash` are inert metadata for this
 * aggregate specifically. They still have to exist because `defineAggregate`
 * always derives one; they are simply never consulted.
 *
 * The aggregate is still named `log`, matching the currently-deployed
 * `AggregateType` value already written into `event_log` (migration `00050`
 * keys `_size_bytes`'s MATERIALIZED expression on
 * `AggregateType IN ('metric', 'log')`) — ADR-105 treats the aggregate name
 * as a persisted identifier, authored once, and there is no reason to move it
 * for this rewrite.
 *
 * === A discrepancy worth flagging ===
 *
 * ADR-105 decision 1's own illustrative example declares an aggregate with a
 * `prefix` field and an `aggregateId` extractor:
 *
 * ```ts
 * defineAggregate({ name: "coding_agent_session", prefix: "lw.obs",
 *   aggregateId: (data) => data.sessionId, ... })
 * ```
 * suggesting a persisted type string shaped like
 * `lw.obs.coding_agent_session.span_facts_contributed` and aggregate-id
 * derivation folded into the same declaration.
 *
 * The actual shipped `defineAggregate` in
 * `packages/event-sourcing/src/aggregate/defineAggregate.ts` has neither.
 * It is curried as `defineAggregate(name).state(...).events(...).commands(...)`
 * with no `prefix` parameter and no `.aggregateId()` step anywhere in the
 * builder — the derived type string is exactly `${name}/${key}` (see
 * `EventTypeString` in `aggregate.types.ts`), and nothing in the package
 * derives an aggregate id from event or command data.
 *
 * This pipeline follows the real, shipped API rather than the ADR's
 * narrative example, per this task's instruction to read `src/index.ts`
 * rather than guess. Two consequences:
 *
 * 1. The derived event type string is `log/recordReceived`, not the old
 *    dotted `lw.obs.log.record_received`. That is an intentional format
 *    change this whole ADR series makes (every aggregate under the new
 *    system uses `name/key`), not something this pipeline's rewrite
 *    invented — and this rewrite does not attempt to bridge or migrate
 *    already-stored `lw.obs.*` rows, which is a whole-system cutover
 *    decision outside one pipeline's scope.
 * 2. Aggregate-id derivation stays a small sibling function
 *    ({@link logRecordAggregateId}) rather than a declaration field, mirroring
 *    how the *old* pipeline already kept it separate too — `getAggregateId`
 *    was a static method on the command class, never part of
 *    `schemas/events.ts`. So this is not a new seam; it is the same seam the
 *    old code had, just not yet absorbed into `defineAggregate`.
 */
export const logRecord = defineAggregate("log")
  .state(canonicalLogRecordSchema.nullable(), () => null)
  .events({
    recordReceived: {
      data: canonicalLogRecordSchema,
      apply: (_state: CanonicalLogRecord | null, data: CanonicalLogRecord) =>
        data,
    },
  })
  .commands({
    recordCanonicalLog: {
      input: canonicalLogRecordSchema,
      handle: (_state, input, events) => [events.recordReceived(input)],
    },
  })
  .build();

/**
 * The aggregate id for a `log` aggregate: the record's own content hash.
 * Every record is its own aggregate of exactly one event — see the module
 * docblock for why this lives beside the declaration rather than inside it.
 */
export function logRecordAggregateId(data: { recordId: string }): string {
  return data.recordId;
}
