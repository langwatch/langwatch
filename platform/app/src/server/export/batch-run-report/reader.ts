import type {
  BatchHistoryResult,
  BatchRunDataResult,
  ScenarioRunData,
} from "~/server/scenarios/scenario-event.types";

/**
 * The three reads a report needs.
 *
 * Narrower than the full simulation repository on purpose: this is the seam the
 * report's tests replace, and a twenty-method interface would make every test
 * carry eighteen stubs it does not use. The real repository satisfies this
 * structurally, so nothing has to adapt it.
 */
export interface BatchRunReportReader {
  /** The run being reported on, with transcripts. */
  getRunDataForBatchRun(params: {
    projectId: string;
    scenarioSetId: string;
    batchRunId: string;
  }): Promise<BatchRunDataResult>;

  /** Which runs came before this one, most recent first. */
  getBatchHistoryForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
  }): Promise<BatchHistoryResult>;

  /** Those runs' outcomes, without their transcripts. */
  findRunOutcomesForBatchIds(params: {
    projectId: string;
    batchRunIds: string[];
    scenarioSetId?: string;
  }): Promise<ScenarioRunData[]>;
}
