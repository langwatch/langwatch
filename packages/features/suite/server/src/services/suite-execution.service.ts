import type { SuiteRunParameters, SuiteRunResult, SuiteTarget } from "@langwatch/suite-contract";
import { getSuiteSetId, targetKeyOf } from "@langwatch/suite-contract";
import { createLogger } from "@langwatch/observability";
import {
  generateBatchRunId,
  type ResolvedRunModels,
  type RunActor,
  type RunSecretCiphertext,
  type ScenarioRunConfig,
  type ScenarioService,
  withActor,
  withNote,
  withResolvedModels,
} from "@langwatch/scenario-contract";
import {
  SuiteExecutionPort,
  SuiteRunCommandsPort,
  SuiteRunIdPort,
} from "../ports/suite-execution.port";
import type { SuiteRunModelsResolver } from "./suite-run-models.service";

const logger = createLogger("langwatch:suite-run:service");

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
  /** Who started the run; every run of the batch records it. */
  actor?: RunActor;
  /**
   * The simulation models the plan was configured with. Stamped onto every
   * run so the run dialog can read a configuration back off the runs and not
   * only off the plan row. Also the "plan" half of the model-resolution
   * chain: what the run really ran on is stamped beside it.
   */
  simulatorModel?: string | null;
  judgeModel?: string | null;
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
    /**
     * Reads, once per batch, the models each queued run really runs on.
     * Absent in a context with no model-default resolution behind it; the
     * runs then record no resolved model, the same as a run recorded before
     * the field existed.
     */
    resolveRunModels?: SuiteRunModelsResolver;
  }): SuiteExecutionService {
    return new SuiteExecutionService(input.commands, input.ids, input.scenarios, input.resolveRunModels);
  }

  private constructor(
    private readonly commands: SuiteRunCommandsPort,
    private readonly ids: SuiteRunIdPort,
    private readonly scenarios: ScenarioService,
    private readonly resolveRunModels?: SuiteRunModelsResolver,
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
   * Run parameters per target, per scenario, with the secret-bearing ones
   * kept apart so they can be attached to the queued run rather than to its
   * metadata.
   *
   * A target's own `runParameters` are merged over the run's values, the
   * target winning — the run dialog lets one agent run twice with different
   * overrides ("prod-agent on gpt-5 vs prod-agent on gpt-5-mini"), and every
   * such target must read its own values back, not the run's shared ones.
   * Two targets that resolve to the same key (same agent, same overrides)
   * resolve once. Secrets are run-level, so every target resolves the same
   * ones; only the first target's resolution is kept.
   */
  private async resolveParameters(input: SuiteExecutionRequest): Promise<{
    parameters: Map<string, Map<string, SuiteRunParameters>>;
    secrets: Map<string, Record<string, string>>;
  }> {
    const parameters = new Map<string, Map<string, SuiteRunParameters>>();
    let secrets: Map<string, Record<string, string>> | undefined;

    for (const target of input.activeTargets) {
      const targetKey = targetKeyOf(target);
      if (parameters.has(targetKey)) {
        continue;
      }

      const resolved = await this.scenarios.resolveRunParametersForScenarios({
        scenarios: input.scenarioConfigs,
        values: { ...input.parameters, ...target.runParameters },
      });

      parameters.set(targetKey, new Map(resolved.map((item) => [item.scenarioId, item.parameters])));
      secrets ??= new Map(
        resolved
          .filter((item) => Object.keys(item.secretParameters).length > 0)
          .map((item) => [item.scenarioId, item.secretParameters]),
      );
    }

    return { parameters, secrets: secrets ?? new Map() };
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
    parameters: Map<string, Map<string, SuiteRunParameters>>;
    secrets: Map<string, Record<string, string>>;
  }): Promise<void> {
    const now = Date.now();
    const simulationModels = SuiteExecutionService.withSimulationModels(input);
    // Read before the first run is queued: every run of the batch says which
    // models it ran on, and the answer must not change part way through it.
    const resolvedModelsByScenarioId: Map<string, ResolvedRunModels> =
      (await this.resolveRunModels?.({
        projectId: input.projectId,
        scenarioIds: input.activeScenarioIds,
        plan: {
          simulatorModel: input.simulatorModel,
          judgeModel: input.judgeModel,
        },
      })) ?? new Map();

    await Promise.allSettled(
      items.map((item) => {
        const secretParameters = secrets.get(item.scenarioId);
        const targetParameters = parameters.get(targetKeyOf(item.target))?.get(item.scenarioId);

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
              ...withActor(input.actor),
              ...simulationModels,
              ...withResolvedModels(resolvedModelsByScenarioId.get(item.scenarioId)),
            },
            ...withNote(input.note),
            ...SuiteExecutionService.withParameters(targetParameters),
            ...SuiteExecutionService.withSecretParameterNames(secretParameters),
          },
          ...SuiteExecutionService.withSecretParameters(secretParameters),
          target: { type: item.target.type, referenceId: item.target.referenceId },
          occurredAt: now,
        });
      }),
    );
  }

  private static withParameters(parameters: Record<string, string | number | boolean> | undefined) {
    return parameters && Object.keys(parameters).length > 0 ? { parameters } : {};
  }

  /**
   * The simulation models the plan was configured with, or nothing at all.
   *
   * A plan that names no model runs on the project default, and records no
   * model rather than the default's name: a configuration is what a person
   * chose, so the same choice has to key the same way after a project
   * default changes.
   *
   * @see specs/scenarios/run-configuration-on-runs.feature
   */
  private static withSimulationModels(models: {
    simulatorModel?: string | null;
    judgeModel?: string | null;
  }): { simulatorModel?: string; judgeModel?: string } {
    return {
      ...(models.simulatorModel ? { simulatorModel: models.simulatorModel } : {}),
      ...(models.judgeModel ? { judgeModel: models.judgeModel } : {}),
    };
  }

  private static withSecretParameterNames(secretParameters: RunSecretCiphertext | undefined) {
    const names = Object.keys(secretParameters ?? {});
    return names.length > 0 ? { secretParameterNames: names } : {};
  }

  private static withSecretParameters(secretParameters: RunSecretCiphertext | undefined) {
    return secretParameters && Object.keys(secretParameters).length > 0 ? { secretParameters } : {};
  }
}
