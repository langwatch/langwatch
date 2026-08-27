import type { SuiteRunParameters, SuiteRunResult, SuiteTarget } from "@langwatch/suite-contract";
import type { ScenarioRunConfig } from "@langwatch/scenario-contract";
import type { StartSuiteRunCommandData } from "@langwatch/suite-contract";

export type QueueSimulationRunCommandData = {
  tenantId: string;
  scenarioRunId: string;
  scenarioId: string;
  batchRunId: string;
  scenarioSetId: string;
  name?: string;
  metadata?: Record<string, unknown>;
  secretParameters?: Record<string, string>;
  target?: { type: "prompt" | "http" | "code" | "workflow"; referenceId: string };
  occurredAt: number;
};

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

/** Durable Eventing commands supplied by the process composition root. */
export abstract class SuiteRunCommandsPort {
  abstract startSuiteRun(data: StartSuiteRunCommandData): Promise<void>;

  abstract queueSimulationRun(data: QueueSimulationRunCommandData): Promise<void>;
}

export abstract class SuiteRunIdPort {
  abstract next(): string;
}
