import type { SuiteRunStateData } from "~/server/event-sourcing/pipelines/suite-run-processing/projections/suiteRunState.foldProjection";

export interface SuiteRunReadRepository {
  getSuiteRunState(params: {
    projectId: string;
    batchRunId: string;
  }): Promise<SuiteRunStateData | null>;

  getBatchHistory(params: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
  }): Promise<SuiteRunStateData[]>;
}

export class NullSuiteRunReadRepository implements SuiteRunReadRepository {
  async getSuiteRunState(): Promise<SuiteRunStateData | null> {
    return null;
  }

  async getBatchHistory(): Promise<SuiteRunStateData[]> {
    return [];
  }
}
