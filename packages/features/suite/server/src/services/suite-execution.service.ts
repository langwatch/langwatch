import type { SuiteRunParameters, SuiteRunResult, SuiteTarget } from "@langwatch/suite-contract";
import { getSuiteSetId } from "@langwatch/suite-contract";
import { createLogger } from "@langwatch/observability";
import {
  generateBatchRunId,
  type RunSecretCiphertext,
  type ScenarioRunConfig,
  type ScenarioService,
  withNote,
} from "@langwatch/scenario-contract";
import {
  SuiteExecutionPort,
  SuiteRunCommandsPort,
  SuiteRunIdPort,
} from "../ports/suite-execution.port";

const logger = createLogger("langwatch:suite-run:service");

function withParameters(parameters: Record<string, string | number | boolean> | undefined) {
  return parameters && Object.keys(parameters).length > 0 ? { parameters } : {};
}

function withSecretParameterNames(secretParameters: RunSecretCiphertext | undefined) {
  const names = Object.keys(secretParameters ?? {});
  return names.length > 0 ? { secretParameterNames: names } : {};
}

function withSecretParameters(secretParameters: RunSecretCiphertext | undefined) {
  return secretParameters && Object.keys(secretParameters).length > 0 ? { secretParameters } : {};
}

/** Turns a validated Suite request into durable Suite-run and Simulation commands. */
export class SuiteExecutionService extends SuiteExecutionPort {
  static create(input: {
    commands: SuiteRunCommandsPort;
    ids: SuiteRunIdPort;
    scenarios: ScenarioService;
  }): SuiteExecutionService {
    return new SuiteExecutionService(input.commands, input.ids, input.scenarios);
  }

  private constructor(
    private readonly commands: SuiteRunCommandsPort,
    private readonly ids: SuiteRunIdPort,
    private readonly scenarios: ScenarioService,
  ) {
    super();
  }

  async execute(input: {
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
  }): Promise<SuiteRunResult> {
    const resolved = await this.scenarios.resolveRunParametersForScenarios({
      scenarios: input.scenarioConfigs,
      values: input.parameters,
    });
    const parameters = new Map(resolved.map((item) => [item.scenarioId, item.parameters]));
    const secrets = new Map(
      resolved
        .filter((item) => Object.keys(item.secretParameters).length > 0)
        .map((item) => [item.scenarioId, item.secretParameters]),
    );
    const batchRunId = input.batchRunId ?? generateBatchRunId();
    const setId = getSuiteSetId(input.suiteId);
    const total = input.activeScenarioIds.length * input.activeTargets.length * input.repeatCount;
    logger.debug(
      { suiteId: input.suiteId, projectId: input.projectId, batchRunId, total },
      "Starting suite run",
    );

    await this.commands.startSuiteRun({
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
    const items = input.activeScenarioIds.flatMap((scenarioId) =>
      input.activeTargets.flatMap((target) =>
        Array.from({ length: input.repeatCount }, (_, repeat) => ({
          scenarioId,
          target,
          repeat,
          scenarioRunId: this.ids.next(),
        })),
      ),
    );
    const now = Date.now();
    await Promise.allSettled(
      items.map((item) => {
        const secretParameters = secrets.get(item.scenarioId);
        return this.commands.queueSimulationRun({
          tenantId: input.projectId,
          scenarioRunId: item.scenarioRunId,
          scenarioId: item.scenarioId,
          batchRunId,
          scenarioSetId: setId,
          name: input.scenarioNames.get(item.scenarioId),
          metadata: {
            langwatch: {
              targetReferenceId: item.target.referenceId,
              targetType: item.target.type,
              scenarioVersion: input.scenarioVersions.get(item.scenarioId),
            },
            ...withNote(input.note),
            ...withParameters(parameters.get(item.scenarioId)),
            ...withSecretParameterNames(secretParameters),
          },
          ...withSecretParameters(secretParameters),
          target: { type: item.target.type, referenceId: item.target.referenceId },
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
