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
  return definePipeline<SuiteRunProcessingEvent>({
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
    .withCommand("startSuiteRun", StartSuiteRunCommand)
    .withCommand("recordSuiteRunItemStarted", RecordSuiteRunItemStartedCommand)
    .withCommand("completeSuiteRunItem", CompleteSuiteRunItemCommand)
    .build();
}
