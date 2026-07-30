import { NOTIFICATION_CADENCES } from "@langwatch/automations/cadences";
import { defineAggregate } from "@langwatch/event-sourcing";
import { TriggerAction } from "@prisma/client";
import { z } from "zod";

/**
 * The `trigger` aggregate (ADR-105): a trace matched one automation's
 * conditions.
 *
 * One event, `matchRecorded`. Identity and timing config only — trace, span
 * and message CONTENT are forbidden on this event by construction (the
 * payload schema below has no field that could carry it). A match is a
 * pointer into the trace pipeline's own aggregate, not a copy of what it
 * points at; ADR-098 decision 8 draws exactly this line for durable
 * references, and a trigger match is the sharpest example of it in the
 * system — every dispatch that needs trace content re-reads it from the
 * trace pipeline's own fold at dispatch time (see
 * `process-managers/triggerSettlement.dispatchPorts.ts`), never from this
 * event.
 *
 * This aggregate has no fold state of its own. Nothing downstream reads back
 * "this trigger's accumulated matches" as a projection — that accumulator is
 * the `triggerSettlement` process manager's own durable state, and ADR-098
 * decision 1 draws the line precisely there: a process manager owns its
 * state, a projection is a read model, and the two are not the same
 * mechanism wearing different names. So `state` here is deliberately inert;
 * this aggregate exists to give a trigger's matches a durable, ordered,
 * replayable identity in the event log, not to answer a read.
 */

const triggerActionClassSchema = z.enum(["notify", "persist"]);
export type TriggerActionClass = z.infer<typeof triggerActionClassSchema>;

export const matchRecordedDataSchema = z.object({
  triggerId: z.string().min(1),
  traceId: z.string().min(1),
  action: z.nativeEnum(TriggerAction),
  actionClass: triggerActionClassSchema,
  traceDebounceMs: z.number().int().nonnegative(),
  notificationCadence: z.enum(NOTIFICATION_CADENCES),
});
export type MatchRecordedData = z.infer<typeof matchRecordedDataSchema>;

const triggerStateSchema = z.object({}).strict();
export type TriggerAggregateState = z.infer<typeof triggerStateSchema>;

export const triggerAggregate = defineAggregate("trigger")
  .state(triggerStateSchema, () => ({}))
  .events({
    matchRecorded: {
      data: matchRecordedDataSchema,
      // No accumulator to update — see the docblock above.
      apply: (state) => state,
    },
  })
  .commands({
    /**
     * Records one trigger match. The command never refuses: a subscriber
     * only calls it once it has already decided a match occurred (see
     * `subscribers/`), so there is nothing left here to validate against
     * aggregate state.
     *
     * **Known gap — no natural key travels with the emitted event.** The old
     * pipeline's `defineCommand` attached a derived `idempotencyKey`
     * (`${triggerId}:${traceId}:${settleWindowBucket(...)}`) to the row, and
     * several of its docblocks read that as suppressing a redelivered
     * command's duplicate write. That reading does not hold against how
     * `event_log` actually behaves: it is a `ReplacingMergeTree`, which
     * dedups only at merge — a background compaction that runs AFTER both
     * rows have already been written and AFTER every downstream fold,
     * subscriber and process manager has already been dispatched both
     * copies, and which keeps the LAST write, not the first. So an
     * idempotency key on the row is a fact available to whatever reads
     * `event_log` back later (replay, an analyst query); it is not a
     * suppression mechanism, and nothing here should be built as though it
     * were. The actual redelivery-safety property this pipeline needs —
     * "the same delivery, applied twice, does not double-count" — is
     * ADR-098 §5's job: a per-group delivery sequence recorded on the
     * PROJECTION's row, checked before apply, which `createFoldExecutor`
     * (`@langwatch/event-sourcing`) already implements for folds. A process
     * manager reads-and-writes its own state the same way a fold does, so
     * the same guard is what `triggerSettlement` needs once an executor
     * exists to provide it (`process-managers/defineProcessManager.ts`) —
     * not a key smuggled through the event payload.
     *
     * `CommandDef` in `@langwatch/event-sourcing` (`aggregate.types.ts`) has
     * no field for a natural/idempotency key at all today — `handle` returns
     * only `readonly EventUnion[]`. `settleWindow.ts` still exports the
     * natural-key function (`settleWindowBucket`) other call sites need for
     * their OWN purposes (see `process-managers/triggerSettlement.ts`), but
     * nothing here treats it as an event-store dedup mechanism.
     */
    recordMatch: {
      input: matchRecordedDataSchema,
      handle: (_state, input, events) => [events.matchRecorded(input)],
    },
  })
  .build();

export type TriggerAggregate = typeof triggerAggregate;
