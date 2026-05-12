/**
 * Langy tool registry — per-tool factories assembled into the map the
 * runtime (currently Vercel AI SDK, Mastra in Phase 4.3+) consumes.
 *
 * Each `make<Tool>(ctx)` reads from `LangyToolContext` instead of free
 * variables, so the same definitions can be threaded through either
 * runtime without changes.
 */
import {
  makeGetEvaluatorDetails,
  makeListEvaluators,
  makeProposeAddEvaluatorToWorkbench,
  makeProposeCreateEvaluator,
  makeProposeDeleteEvaluator,
  makeProposeUpdateEvaluator,
} from "./evaluators";
import {
  makeGetPromptDetails,
  makeListPrompts,
  makeProposeCreatePrompt,
  makeProposeUpdatePrompt,
  makeSearchPrompts,
} from "./prompts";
import {
  makeGetDatasetDetails,
  makeListDatasets,
  makeProposeAddDatasetRows,
  makeProposeCreateDataset,
} from "./datasets";
import {
  makeFindFailingRows,
  makeGetWorkbenchState,
  makeProposeRunWorkbench,
} from "./workbench";
import { makeSearchTraces } from "./traces";
import { makeSearchPastRuns } from "./runs";
import type { LangyToolContext } from "./types";

export type { LangyToolContext } from "./types";

export function buildLangyTools(ctx: LangyToolContext) {
  return {
    list_evaluators: makeListEvaluators(ctx),
    get_evaluator_details: makeGetEvaluatorDetails(ctx),
    list_prompts: makeListPrompts(ctx),
    list_datasets: makeListDatasets(ctx),
    get_workbench_state: makeGetWorkbenchState(ctx),
    find_failing_rows: makeFindFailingRows(ctx),
    propose_create_evaluator: makeProposeCreateEvaluator(ctx),
    get_prompt_details: makeGetPromptDetails(ctx),
    get_dataset_details: makeGetDatasetDetails(ctx),
    propose_create_prompt: makeProposeCreatePrompt(ctx),
    propose_update_prompt: makeProposeUpdatePrompt(ctx),
    propose_create_dataset: makeProposeCreateDataset(ctx),
    propose_add_dataset_rows: makeProposeAddDatasetRows(ctx),
    propose_update_evaluator: makeProposeUpdateEvaluator(ctx),
    propose_delete_evaluator: makeProposeDeleteEvaluator(ctx),
    propose_run_workbench: makeProposeRunWorkbench(ctx),
    propose_add_evaluator_to_workbench: makeProposeAddEvaluatorToWorkbench(ctx),
    search_traces: makeSearchTraces(ctx),
    search_prompts: makeSearchPrompts(ctx),
    search_past_runs: makeSearchPastRuns(ctx),
  };
}
