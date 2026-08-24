import {
  type SuiteRunParameters,
  type SuiteRunResult,
  type SuiteTarget,
} from "@langwatch/suite-contract";
import type { ScenarioRunConfig } from "@langwatch/scenario-contract";
import { SuiteExecutionPort } from "@langwatch/suite-server";
import { resolveRunParameters } from "~/server/scenarios/resolve-run-parameters";
import {
  encryptRunSecretValues,
  type RunSecretCiphertext,
} from "~/server/scenarios/run-secret-values";
import type { SuiteRunService } from "~/server/app-layer/suites/suite-run.service";

/**
 * Application composition for suite execution. The feature service validates
 * suite references; this adapter resolves run-only parameters and records the
 * event-sourced work through the existing scheduler.
 */
export class AppSuiteExecutionPort extends SuiteExecutionPort {
  static create(options: { suiteRuns: SuiteRunService }): AppSuiteExecutionPort {
    return new AppSuiteExecutionPort(options.suiteRuns);
  }

  private constructor(private readonly suiteRuns: SuiteRunService) {
    super();
  }

  async execute(input: {
    suiteId: string;
    projectId: string;
    activeScenarioIds: string[];
    scenarioNames: Map<string, string>;
    scenarioConfigs: ScenarioRunConfig[];
    activeTargets: SuiteTarget[];
    repeatCount: number;
    skippedArchived: SuiteRunResult["skippedArchived"];
    idempotencyKey: string;
    batchRunId?: string;
    parameters?: SuiteRunParameters;
  }): Promise<SuiteRunResult> {
    const resolved = await resolveRunParameters({
      scenarios: input.scenarioConfigs,
      values: input.parameters,
    });
    const parametersByScenarioId = new Map(
      [...resolved].map(([scenarioId, parameters]) => [
        scenarioId,
        parameters.parameters,
      ]),
    );
    const secretParametersByScenarioId = new Map<string, RunSecretCiphertext>(
      [...resolved]
        .filter(([, parameters]) => Object.keys(parameters.secretParameters).length > 0)
        .map(([scenarioId, parameters]) => [
          scenarioId,
          encryptRunSecretValues(parameters.secretParameters),
        ]),
    );
    return this.suiteRuns.startRun({
      suiteId: input.suiteId,
      projectId: input.projectId,
      activeScenarioIds: input.activeScenarioIds,
      scenarioNameMap: input.scenarioNames,
      activeTargets: input.activeTargets,
      repeatCount: input.repeatCount,
      skippedArchived: input.skippedArchived,
      idempotencyKey: input.idempotencyKey,
      batchRunId: input.batchRunId,
      parametersByScenarioId,
      secretParametersByScenarioId,
    });
  }
}
