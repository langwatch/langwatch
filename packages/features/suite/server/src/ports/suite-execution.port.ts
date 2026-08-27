import type { SuiteRunParameters, SuiteRunResult, SuiteTarget } from "@langwatch/suite-contract";
import type { ScenarioRunConfig } from "@langwatch/scenario-contract";

/**
 * The application-specific boundary for turning a validated suite run into
 * durable events and queued work. Event sourcing remains application
 * composition; suite policy does not depend on its repositories.
 */
export abstract class SuiteExecutionPort {
  abstract execute(input: {
    suiteId: string;
    projectId: string;
    activeScenarioIds: string[];
    scenarioNames: Map<string, string>;
    scenarioVersions: Map<string, number>;
    scenarioConfigs: ScenarioRunConfig[];
    activeTargets: SuiteTarget[];
    repeatCount: number;
    skippedArchived: SuiteRunResult["skippedArchived"];
    idempotencyKey: string;
    batchRunId?: string;
    parameters?: SuiteRunParameters;
    note?: string;
  }): Promise<SuiteRunResult>;
}
