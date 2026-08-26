import {
  type SuiteRunParameters,
  type SuiteRunResult,
  type SuiteTarget,
} from "@langwatch/suite-contract";
import { SuiteExecutionPort } from "@langwatch/suite-server";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { QueueRunCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import type { StartSuiteRunCommandData } from "~/server/event-sourcing/pipelines/suite-run-processing/schemas/commands";
import {
  generateBatchRunId,
  type RunSecretCiphertext,
  type ScenarioRunConfig,
  type ScenarioService,
} from "@langwatch/scenario-contract";
import { getSuiteSetId } from "@langwatch/suite-contract";
import { KSUID_RESOURCES } from "~/utils/constants";

const logger = createLogger("langwatch:suite-run:service");

function withParameters(
  parameters: Record<string, string | number | boolean> | undefined,
): { parameters: Record<string, string | number | boolean> } | Record<string, never> {
  return parameters && Object.keys(parameters).length > 0 ? { parameters } : {};
}

function withSecretParameterNames(
  secretParameters: RunSecretCiphertext | undefined,
): { secretParameterNames: string[] } | Record<string, never> {
  const names = Object.keys(secretParameters ?? {});
  return names.length > 0 ? { secretParameterNames: names } : {};
}

function withSecretParameters(
  secretParameters: RunSecretCiphertext | undefined,
): { secretParameters: RunSecretCiphertext } | Record<string, never> {
  return secretParameters && Object.keys(secretParameters).length > 0
    ? { secretParameters }
    : {};
}

/**
 * Application composition for recording a validated Suite run through the
 * existing event-sourced scheduler. Scenario owns parameter resolution and
 * encryption; this adapter only maps its result onto durable commands.
 */
export class AppSuiteExecutionPort extends SuiteExecutionPort {
  static create(options: {
    startSuiteRun: (data: StartSuiteRunCommandData) => Promise<void>;
    queueSimulationRun: (data: QueueRunCommandData) => Promise<void>;
    scenarios: ScenarioService;
  }): AppSuiteExecutionPort {
    return new AppSuiteExecutionPort(
      options.startSuiteRun,
      options.queueSimulationRun,
      options.scenarios,
    );
  }

  private constructor(
    private readonly startSuiteRunCommand: (
      data: StartSuiteRunCommandData,
    ) => Promise<void>,
    private readonly queueSimulationRunCommand: (
      data: QueueRunCommandData,
    ) => Promise<void>,
    private readonly scenarios: ScenarioService,
  ) {
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
    const scenarioParameters = await this.scenarios.resolveRunParametersForScenarios({
      scenarios: input.scenarioConfigs,
      values: input.parameters,
    });
    const parametersByScenarioId = new Map(
      scenarioParameters.map((resolved) => [resolved.scenarioId, resolved.parameters]),
    );
    const secretParametersByScenarioId = new Map<string, RunSecretCiphertext>(
      scenarioParameters
        .filter((resolved) => Object.keys(resolved.secretParameters).length > 0)
        .map((resolved) => [resolved.scenarioId, resolved.secretParameters]),
    );
    const batchRunId = input.batchRunId ?? generateBatchRunId();
    const setId = getSuiteSetId(input.suiteId);
    const total =
      input.activeScenarioIds.length * input.activeTargets.length * input.repeatCount;

    logger.debug(
      {
        suiteId: input.suiteId,
        projectId: input.projectId,
        batchRunId,
        activeScenarioCount: input.activeScenarioIds.length,
        activeTargetCount: input.activeTargets.length,
        repeatCount: input.repeatCount,
        total,
      },
      "Starting suite run",
    );

    await this.startSuiteRunCommand({
      tenantId: input.projectId,
      batchRunId,
      scenarioSetId: setId,
      suiteId: input.suiteId,
      total,
      scenarioIds: input.activeScenarioIds,
      targetIds: input.activeTargets.map((target) => target.referenceId),
      idempotencyKey: input.idempotencyKey,
      occurredAt: Date.now(),
    });

    const items: Array<{
      scenarioId: string;
      target: SuiteTarget;
      repeat: number;
      scenarioRunId: string;
    }> = [];
    for (const scenarioId of input.activeScenarioIds) {
      for (const target of input.activeTargets) {
        for (let repeat = 0; repeat < input.repeatCount; repeat++) {
          items.push({
            scenarioId,
            target,
            repeat,
            scenarioRunId: generate(KSUID_RESOURCES.SCENARIO_RUN).toString(),
          });
        }
      }
    }

    const now = Date.now();
    await Promise.allSettled(
      items.map((item) => {
        const secretParameters = secretParametersByScenarioId.get(item.scenarioId);
        return this.queueSimulationRunCommand({
          tenantId: input.projectId,
          scenarioRunId: item.scenarioRunId,
          scenarioId: item.scenarioId,
          batchRunId,
          scenarioSetId: setId,
          name: input.scenarioNames.get(item.scenarioId),
          metadata: {
            langwatch: { targetReferenceId: item.target.referenceId },
            ...withParameters(parametersByScenarioId.get(item.scenarioId)),
            ...withSecretParameterNames(secretParameters),
          },
          ...withSecretParameters(secretParameters),
          target: {
            type: item.target.type,
            referenceId: item.target.referenceId,
          },
          occurredAt: now,
        });
      }),
    );

    logger.debug(
      { suiteId: input.suiteId, batchRunId, itemCount: items.length },
      "Suite run queued via event-sourcing",
    );

    return {
      batchRunId,
      setId,
      jobCount: items.length,
      skippedArchived: input.skippedArchived,
      items: items.map((item) => ({
        scenarioRunId: item.scenarioRunId,
        scenarioId: item.scenarioId,
        target: item.target,
        name: input.scenarioNames.get(item.scenarioId),
      })),
    };
  }
}
