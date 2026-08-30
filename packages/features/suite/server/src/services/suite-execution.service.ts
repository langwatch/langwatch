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
/** Everything one suite run needs, resolved by the caller before it starts. */
export type SuiteExecutionRequest = {
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
};

/** One scenario, against one target, on one repeat. */
type SuiteExecutionItem = {
  scenarioId: string;
  target: SuiteTarget;
  repeat: number;
  scenarioRunId: string;
};

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

  async execute(input: SuiteExecutionRequest): Promise<SuiteRunResult> {
    const { parameters, secrets } = await this.resolveParameters(input);
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

    // Ids are minted only once the run is on record, so a failed start does not
    // burn a block of scenario run ids.
    const items = this.planItems(input);
    await this.queueAll({ input, items, batchRunId, setId, parameters, secrets });

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

  /**
   * Run parameters per scenario, with the secret-bearing ones kept apart so
   * they can be attached to the queued run rather than to its metadata.
   */
  private async resolveParameters(input: SuiteExecutionRequest): Promise<{
    parameters: Map<string, SuiteRunParameters>;
    secrets: Map<string, Record<string, string>>;
  }> {
    const resolved = await this.scenarios.resolveRunParametersForScenarios({
      scenarios: input.scenarioConfigs,
      values: input.parameters,
    });

    return {
      parameters: new Map(resolved.map((item) => [item.scenarioId, item.parameters])),
      secrets: new Map(
        resolved
          .filter((item) => Object.keys(item.secretParameters).length > 0)
          .map((item) => [item.scenarioId, item.secretParameters]),
      ),
    };
  }

  /** One run per scenario, per target, per repeat. */
  private planItems(input: SuiteExecutionRequest): SuiteExecutionItem[] {
    return input.activeScenarioIds.flatMap((scenarioId) =>
      input.activeTargets.flatMap((target) =>
        Array.from({ length: input.repeatCount }, (_, repeat) => ({
          scenarioId,
          target,
          repeat,
          scenarioRunId: this.ids.next(),
        })),
      ),
    );
  }

  /**
   * Queues every run against one timestamp, and settles rather than races: one
   * scenario failing to queue must not strand the rest of the suite.
   */
  private async queueAll({
    input,
    items,
    batchRunId,
    setId,
    parameters,
    secrets,
  }: {
    input: SuiteExecutionRequest;
    items: SuiteExecutionItem[];
    batchRunId: string;
    setId: string;
    parameters: Map<string, SuiteRunParameters>;
    secrets: Map<string, Record<string, string>>;
  }): Promise<void> {
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
  }
}
