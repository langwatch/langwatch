import {
  defineAggregate,
  defineEvents,
  definePipeline,
  type FoldProjectionStore,
} from "@langwatch/eventing";
import type { SuiteRunStateData } from "@langwatch/suite-contract";
import {
  CompleteSuiteRunItemCommand,
  RecordSuiteRunItemStartedCommand,
  StartSuiteRunCommand,
} from "./suite-run-commands.adapter";
import { SuiteRunStateFoldProjection } from "../projections/suite-run-state.projection";
import { SUITE_RUN_PROCESSING_EVENT_TYPES } from "@langwatch/suite-contract";
import type { SuiteRunProcessingEvent } from "@langwatch/suite-contract";

export interface SuiteRunProcessingPipelineDeps {
  suiteRunStateFoldStore: FoldProjectionStore<SuiteRunStateData>;
}

/**
 * How long a suite command's job id stays claimed. One minute, matching the
 * simulation pipeline's `computeRunMetrics`, and long enough to cover the
 * queue's own retry window — the redelivery this guards against arrives when a
 * dispatch throws and the GroupQueue re-runs the subscriber, not hours later.
 *
 * This is a queue-level guard, and the rule that asks for redelivery proof says
 * plainly that queue deduplication is not sufficient on its own. It is not
 * sufficient here either: the durable fix is for the fold executor to drop a
 * replay on `idempotencyKey ?? id` rather than `id` alone, which would make the
 * accumulating fold safe by construction. Until then this closes the window
 * that is actually reachable.
 */
const SUITE_COMMAND_DEDUP_TTL_MS = 60_000;

/**
 * The command's own job id, required at this seam rather than optional.
 *
 * `defineCommand` types `makeJobId` as optional because not every command needs
 * one. A command registered WITH deduplication does, and reading it as
 * `undefined` would quietly restore the accumulating double-count the
 * registration exists to prevent. Failing when the pipeline is composed is the
 * loud version of that, and it happens at boot rather than under load.
 */
function requireJobId<TPayload>(
  commandName: string,
  makeJobId: ((payload: TPayload) => string) | undefined,
): (payload: TPayload) => string {
  if (!makeJobId) {
    throw new Error(
      `Suite command "${commandName}" is registered with deduplication but defines no makeJobId`,
    );
  }
  return makeJobId;
}

/**
 * Creates the suite run processing pipeline definition.
 *
 * This pipeline uses suite_run aggregates (aggregateId = batchRunId).
 * It tracks the lifecycle of suite runs:
 * - started -> items started/completed
 *
 * Fold Projection: suiteRunState
 * - Computes summary statistics (progress, pass rate, status)
 * - Stored in suite_runs ClickHouse table
 *
 * Commands:
 * - startSuiteRun: Emits SuiteRunStartedEvent when suite run begins
 * - recordSuiteRunItemStarted: Emits SuiteRunItemStartedEvent per item
 * - completeSuiteRunItem: Emits SuiteRunItemCompletedEvent when item finishes
 *
 * No subscriber on this pipeline — cross-pipeline subscribers live on the simulation pipeline.
 */
export function createSuiteRunProcessingPipeline(deps: SuiteRunProcessingPipelineDeps) {
  return (
    definePipeline<SuiteRunProcessingEvent>({
      name: "suite_run_processing",
      aggregate: defineAggregate({
        type: "suite_run",
        events: defineEvents(SUITE_RUN_PROCESSING_EVENT_TYPES),
      }),
    })
      .withClickHouseFoldProjection(
        new SuiteRunStateFoldProjection({
          store: deps.suiteRunStateFoldStore,
        }),
      )
      // Every one of these three folds by addition — StartedCount + 1,
      // CompletedCount + 1, FailedCount + 1 — and the fold executor drops a
      // replay by `event.id`, which two deliveries of the same command do not
      // share. All three commands define `makeJobId`, but `withCommand` reads
      // deduplication only from these options, so without them the method is
      // inert and a redelivered simulation event double-counts a suite run's
      // progress, which can flip its status to SUCCESS or FAILURE before the
      // run has finished.
      .withCommand("startSuiteRun", StartSuiteRunCommand, {
        deduplication: {
          makeId: requireJobId("startSuiteRun", StartSuiteRunCommand.makeJobId),
          ttlMs: SUITE_COMMAND_DEDUP_TTL_MS,
        },
      })
      .withCommand("recordSuiteRunItemStarted", RecordSuiteRunItemStartedCommand, {
        deduplication: {
          makeId: requireJobId(
            "recordSuiteRunItemStarted",
            RecordSuiteRunItemStartedCommand.makeJobId,
          ),
          ttlMs: SUITE_COMMAND_DEDUP_TTL_MS,
        },
      })
      .withCommand("completeSuiteRunItem", CompleteSuiteRunItemCommand, {
        deduplication: {
          makeId: requireJobId("completeSuiteRunItem", CompleteSuiteRunItemCommand.makeJobId),
          ttlMs: SUITE_COMMAND_DEDUP_TTL_MS,
        },
      })
      .build()
  );
}

/**
 * The definition this feature registers, named so a composition root can hold
 * one without restating its shape.
 */
export type SuiteRunProcessingPipeline = ReturnType<typeof createSuiteRunProcessingPipeline>;
