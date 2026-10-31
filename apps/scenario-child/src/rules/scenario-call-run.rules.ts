/**
 * The scenario run a target's calls name: a connected agent's turns and hooks (ADR-180) and an
 * HTTP agent's hooks (ADR-188) carry the same three ids.
 */

import type { ChildProcessJobData } from "@langwatch/scenario-contract";

/** The scenario run a call belongs to; every id is absent outside a scenario run. */
export interface ScenarioCallRun {
  scenarioRunId?: string;
  scenarioName?: string;
  batchRunId?: string;
}

/** The run every call of this job names. */
export function callRunOf(jobData: ChildProcessJobData): ScenarioCallRun {
  return {
    ...(jobData.scenarioRunId ? { scenarioRunId: jobData.scenarioRunId } : {}),
    scenarioName: jobData.scenario.name,
    batchRunId: jobData.context.batchRunId,
  };
}
