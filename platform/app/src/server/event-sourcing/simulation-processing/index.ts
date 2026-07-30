import {
  type AggregateEvent,
  createFoldExecutor,
  type FoldOutcome,
  type Metrics,
  type ReplaceStore,
  UndecodableStateError,
} from "@langwatch/event-sourcing";
import { simulationRun } from "./aggregate";
import type { SimulationRunState } from "./schema";

/**
 * The `simulation-processing` pipeline entry point (ADR-102, ADR-105).
 *
 * ## What is, and is not, in this rewrite
 *
 * This package exports the pieces ADR-105 asks a pipeline to declare: the
 * `simulation_run` aggregate (`aggregate.ts`), its ClickHouse table
 * (`table.ts`) and store (`store.ts`), its dispatch-plane group key
 * (`dispatch.ts`), and its ADR-103 read-side query (`batchAggregates.ts`).
 * What it deliberately does NOT reproduce, because the infrastructure these
 * would sit on top of has not itself converted onto `@langwatch/event-sourcing`
 * yet — none of it is exported from that package's `src/index.ts` today:
 *
 * - **Event persistence and fan-out.** `EventSourcingService.storeEvents`,
 *   the sole writer of `event_log`, is dispatch-plane / composition-root
 *   infrastructure (ADR-098 decision 1, ADR-102). This pipeline's commands
 *   decide events; nothing here appends one to a log or dispatches one to a
 *   queue.
 * - **The GroupQueue lane a fold's `scope: aggregate` promises.** ADR-100
 *   requires a fold's lane to serialise every concurrent apply to one
 *   aggregate, which is what stops two overlapping writers losing an update
 *   to each other's read-modify-write cycle. `dispatch.ts` builds the group
 *   key descriptor that names that lane; nothing here is the queue that
 *   enforces it. See {@link applySimulationRunCommand}'s own docblock for
 *   the concrete consequence.
 * - **Subscribers and process managers.** The SSE broadcast on every
 *   snapshot, the Redis cancellation pub/sub, the `runMetrics` settle-period
 *   and the `scenarioExecution` liveness process (deadline, stall write,
 *   graceful-shutdown drain) are, per ADR-098 decision 1, durable
 *   at-least-once actors with their own state and ports (a broadcast
 *   service, a cancellation channel, a durable outbox) — none of which
 *   `@langwatch/event-sourcing` exports a contract for yet. Reproducing them
 *   here would mean inventing that contract inside one pipeline, which is
 *   exactly the kind of unrequested mechanism the composition root (ADR-102)
 *   exists to own instead. What this rewrite preserves for graceful shutdown
 *   is narrower and does not need that machinery: see
 *   {@link applySimulationRunCommand}'s defect-#3 note.
 * - **`computeRunMetrics`'s trace-derivation half.** Reading another
 *   pipeline's stored spans/summaries is a cross-pipeline concern ADR-098
 *   decision 9 says needs a command bridge, and trace-processing has not
 *   converted yet (ADR-105's own "Known debt", step 3). `aggregate.ts`'s
 *   `recordMetrics` command keeps only the pure half: given already-derived
 *   values, decide the event.
 * - **`lw.simulation_set.archived`.** Tracked separately in the old pipeline
 *   (lw#3636) as a set-scoped aggregate never wired through the run fold's
 *   fan-out; out of scope for the same reason there.
 */

export {
  outranksStoredTerminal,
  type SimulationRunAggregate,
  simulationRun,
} from "./aggregate";
export {
  type BatchAggregate,
  type BatchAggregateQuery,
  buildBatchAggregateQuery,
  decodeBatchAggregateRows,
  queryBatchAggregates,
} from "./batchAggregates";
export {
  renderSimulationRunFoldGroupKey,
  simulationRunFoldGroupKey,
} from "./dispatch";
export * from "./schema";
export {
  createSimulationRunsStore,
  type SimulationRunsStoreArgs,
} from "./store";
export { type SimulationRunsRow, simulationRunsTable } from "./table";

const PROJECTION_NAME = "simulationRunState";

export interface SimulationProcessingPipelineDeps {
  readonly store: ReplaceStore<SimulationRunState>;
  readonly metrics?: Metrics;
}

/** A command name this aggregate declares — see `aggregate.ts`'s `.commands({...})`. */
export type SimulationRunCommandName = keyof typeof simulationRun.commands;

export interface ApplySimulationRunCommandArgs {
  readonly tenantId: string;
  readonly scenarioRunId: string;
  readonly command: SimulationRunCommandName;
  /**
   * Validated at runtime against the named command's own declared `input`
   * schema (`aggregate.ts`) before `handle` ever sees it — kept `unknown`
   * here rather than indexed off `Command` generically, so a caller's
   * mistake surfaces as a `ZodError` naming the offending field instead of a
   * type-level mismatch several layers removed from the call site.
   */
  readonly input: unknown;
  readonly retentionDays?: number;
}

export interface SimulationProcessingPipeline {
  readonly aggregate: typeof simulationRun;
  applySimulationRunCommand(
    args: ApplySimulationRunCommandArgs,
  ): Promise<FoldOutcome>;
}

/**
 * `simulationRun.commands[name]` indexed by a union key type resolves to a
 * union of differently-shaped `CommandDef`s, and calling `.handle` on a
 * union of functions with incompatible parameter types does not typecheck —
 * the same variance problem `@langwatch/clickhouse`'s `AnyColumnDef` exists
 * to name (`packages/clickhouse/src/schema/columns.ts`). `args.input` is
 * validated at the actual runtime boundary by `commandDef.input.parse(...)`
 * before `handle` ever sees it (see `applySimulationRunCommand` below), so
 * the cast below narrows a compile-time-only limitation, not a runtime
 * safety hole.
 */
interface AnyCommandDef {
  readonly input: { parse: (data: unknown) => unknown };
  readonly handle: (
    state: SimulationRunState,
    input: unknown,
    events: typeof simulationRun.events,
  ) => readonly AggregateEvent[];
}

/**
 * Wires the aggregate onto one store, and returns the pipeline's one
 * command-handling entry point.
 */
export function createSimulationProcessingPipeline(
  deps: SimulationProcessingPipelineDeps,
): SimulationProcessingPipeline {
  const executor = createFoldExecutor<SimulationRunState, AggregateEvent>({
    store: deps.store,
    init: simulationRun.init,
    apply: simulationRun.apply,
    stateVersion: simulationRun.stateVersion,
    projectionName: PROJECTION_NAME,
    metrics: deps.metrics,
  });

  return {
    aggregate: simulationRun,

    /**
     * Reads current state, lets the named command decide which events to
     * try, folds them, and writes the result back — fully awaited end to
     * end.
     *
     * **Defect #3 (graceful shutdown settles in-flight runs).** The
     * returned promise resolves only after `deps.store.write()` resolves,
     * and `store.ts`'s `write()` in turn only resolves once
     * `ClickHouseClient.insert()` confirms the row is durable
     * (`wait_for_async_insert: 1`, hard-coded with no override in
     * `@langwatch/clickhouse`). Nothing in this call chain detaches a write
     * from its caller — no `void`, no fire-and-forget, no swallowed
     * rejection that lets a caller believe it finished before the row
     * landed. A caller that awaits this function — including a graceful-
     * shutdown routine settling whatever runs it is still holding, the
     * mechanism the old `settleInFlightRuns` implements in
     * `src/server/scenarios/scenario.processor.ts` — therefore knows the
     * run's terminal state is durable the moment the await returns. This is
     * the property that makes settling in-flight runs on shutdown possible
     * at all; this rewrite does not reproduce `settleInFlightRuns` itself
     * (it lives outside this pipeline's directory and depends on the
     * execution pool, not the fold), only the awaitable, non-detached write
     * path it depends on.
     *
     * **Not a substitute for the dispatch plane's mutual exclusion.** ADR-100
     * requires a fold's lane to serialise concurrent applies to one
     * aggregate; `dispatch.ts` names that lane but nothing enforces it here.
     * Two concurrent calls to this function for the SAME `scenarioRunId`
     * can each read the row before the other's write lands, decide events
     * against the same prior state, and race `deliverySeq` — the classic
     * lost update ADR-100's `fold-scope-must-be-aggregate` rule exists to
     * rule out. Safe for sequential/single-writer use; a composition root
     * wiring this pipeline into production must route calls through a
     * queue honouring `simulationRunFoldGroupKey`'s lane before concurrent
     * callers are safe. Flagged rather than silently assumed away — the
     * queue that would close this gap is dispatch-plane infrastructure
     * (ADR-100) not yet built onto these packages.
     *
     * **`deliverySeq` is derived from the read, not assigned at a separate
     * staging step.** ADR-098 decision 5 assigns it once, atomically, when a
     * job is staged onto a queue — infrastructure this pipeline does not
     * have. This function approximates it as "one more than whatever this
     * row already has", which keeps the *shape* of the redelivery guard
     * correct and testable, but only a real staging queue gives a retried
     * delivery the SAME `deliverySeq` a second time; without one, this
     * function cannot itself distinguish a genuine retry from a fresh call.
     */
    async applySimulationRunCommand(args) {
      const read = await deps.store.read(args.scenarioRunId, {
        tenantId: args.tenantId,
        retentionDays: args.retentionDays,
      });

      if (read.kind === "undecodable") {
        throw new UndecodableStateError({
          projectionName: PROJECTION_NAME,
          aggregateId: args.scenarioRunId,
          storedVersion: read.storedVersion,
          expectedVersion: simulationRun.stateVersion,
          cause: read.cause,
        });
      }

      const state =
        read.kind === "found" ? read.stored.state : simulationRun.init();
      const nextDeliverySeq =
        read.kind === "found" ? read.stored.deliverySeq + 1 : 1;

      const commandDef = simulationRun.commands[
        args.command
      ] as unknown as AnyCommandDef;
      const input = commandDef.input.parse(args.input);
      const events = commandDef.handle(state, input, simulationRun.events);

      return executor.apply({
        key: args.scenarioRunId,
        tenantId: args.tenantId,
        deliverySeq: nextDeliverySeq,
        events,
        retentionDays: args.retentionDays,
      });
    },
  };
}
