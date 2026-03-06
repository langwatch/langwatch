import { definePipeline } from "../../";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import { StartScenarioCommand } from "./commands/startScenario.command";
import { RecordScenarioResultCommand } from "./commands/recordScenarioResult.command";
import { createSuiteRunStateFoldProjection, type SuiteRunStateData } from "./projections/suiteRunState.foldProjection";
import { createSuiteRunItemsFoldProjection, type SuiteRunItemsData } from "./projections/suiteRunItems.foldProjection";
import type { SuiteRunProcessingEvent } from "./schemas/events";

export interface SuiteRunProcessingPipelineDeps {
  suiteRunStore: FoldProjectionStore<SuiteRunStateData>;
  suiteRunItemsStore: FoldProjectionStore<SuiteRunItemsData>;
  suiteRunBroadcastReactor: ReactorDefinition<SuiteRunProcessingEvent, SuiteRunStateData>;
  StartSuiteRunCommandClass: {
    new (): any;
    readonly schema: any;
    getAggregateId(payload: any): string;
    getSpanAttributes?(payload: any): Record<string, string | number | boolean>;
    makeJobId(payload: any): string;
  };
}

/**
 * Creates the suite run processing pipeline definition.
 *
 * This pipeline uses suite_run aggregates (aggregateId = suiteId:batchRunId).
 * It tracks the lifecycle of suite runs at the batch level:
 * - started -> scenario results accumulate -> auto-completes when all done
 *
 * Fold Projections:
 * - suiteRunState: Tracks suite run state (progress, counts, pass rate, status)
 * - suiteRunItems: Tracks per-scenario lifecycle (started → finished)
 *
 * Commands:
 * - startSuiteRun: Schedules BullMQ jobs + emits SuiteRunStartedEvent
 * - startScenario: Emits SuiteRunScenarioStartedEvent when a scenario begins
 * - recordScenarioResult: Emits SuiteRunScenarioResultEvent for each scenario completion
 */
export function createSuiteRunProcessingPipeline(deps: SuiteRunProcessingPipelineDeps) {
  return definePipeline<SuiteRunProcessingEvent>()
    .withName("suite_run_processing")
    .withAggregateType("suite_run")
    .withFoldProjection("suiteRunState", createSuiteRunStateFoldProjection({
      store: deps.suiteRunStore,
    }))
    .withFoldProjection("suiteRunItems", createSuiteRunItemsFoldProjection({
      store: deps.suiteRunItemsStore,
    }))
    .withReactor("suiteRunState", "suiteRunBroadcast", deps.suiteRunBroadcastReactor)
    .withCommand("startSuiteRun", deps.StartSuiteRunCommandClass)
    .withCommand("startScenario", StartScenarioCommand)
    .withCommand("recordScenarioResult", RecordScenarioResultCommand)
    .build();
}
