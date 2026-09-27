import { createLogger } from "@langwatch/observability";
import type {
  ResolvedRunModels,
  RunActor,
  ScenarioRunConfig,
  ScenarioApi,
} from "@langwatch/scenario-contract";
import type { SuiteRunParameters, SuiteRunResult, SuiteTarget } from "@langwatch/suite-contract";
import { getSuiteSetId, hasParameterOverrides, targetKeyOf } from "@langwatch/suite-contract";
import { nowInstant } from "@langwatch/time";

import { type SuiteExecution, type SuiteRunCommands } from "../app/suite.app.ts";
import { deriveBatchRunId, deriveScenarioRunId } from "../rules/suite-run-identity.rules.ts";
import type { SuiteRunModelsResolver } from "./suite-run-models.service.ts";

const logger = createLogger("langwatch:suite-run:service");

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
   * The simulation models the plan was configured with. Stamped onto every run so the run
   * dialog can read a configuration back off the runs and not only off the plan row.
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

/** What the service asks of the scenario owner: resolving a run's values, and queueing each run. */
type SuiteExecutionScenarios = Pick<
  ScenarioApi,
  "resolveRunParametersForScenarios" | "queueSimulationRun"
>;

/** Starts the suite run on its own pipeline, then has the scenario owner queue each run of it. */
export class SuiteExecutionService implements SuiteExecution {
  static create(input: {
    commands: SuiteRunCommands;
    scenarios: SuiteExecutionScenarios;
    /**
     * Reads, once per batch, the models each queued run really runs on. Absent in a context
     * with no model-default resolution behind it; the runs then record no resolved model, the
     * same as a run recorded before the field existed.
     */
    resolveRunModels?: SuiteRunModelsResolver;
  }): SuiteExecutionService {
    return new SuiteExecutionService(input.commands, input.scenarios, input.resolveRunModels);
  }

  private constructor(
    private readonly commands: SuiteRunCommands,
    private readonly scenarios: SuiteExecutionScenarios,
    private readonly resolveRunModels?: SuiteRunModelsResolver,
  ) {}

  async execute(input: SuiteExecutionRequest): Promise<SuiteRunResult> {
    const { parameters, secrets } = await this.resolveParameters(input);
    // A caller that pinned the run's identity keeps it; everyone else gets the
    // identity their idempotency key and their configuration name, so a retry
    // of the same request is the same run rather than a second one.
    const batchRunId = input.batchRunId ?? deriveBatchRunId(input);
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
      occurredAt: nowInstant().epochMilliseconds,
    });

    const items = SuiteExecutionService.planItems({ input, batchRunId });
    // A run the queue refused has no run and never will, so it is reported
    // neither in the count nor in the list.
    const queuedItems = await this.queueAll({
      input,
      items,
      batchRunId,
      setId,
      parameters,
      secrets,
    });

    logger.debug(
      {
        suiteId: input.suiteId,
        batchRunId,
        itemCount: items.length,
        queuedCount: queuedItems.length,
      },
      "Suite run queued via event-sourcing",
    );

    return {
      batchRunId,
      setId,
      jobCount: queuedItems.length,
      skippedArchived: input.skippedArchived,
      items: queuedItems.map((item) => ({
        scenarioRunId: item.scenarioRunId,
        scenarioId: item.scenarioId,
        target: item.target,
        name: input.scenarioNames.get(item.scenarioId),
      })),
    };
  }

  /**
   * Run parameters per target, per scenario, with the secret-bearing ones kept apart so they
   * can be attached to the queued run rather than to its metadata.
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

      parameters.set(
        targetKey,
        new Map(resolved.map((item) => [item.scenarioId, item.parameters])),
      );
      secrets ??= new Map(
        resolved
          .filter((item) => Object.keys(item.secretParameters).length > 0)
          .map((item) => [item.scenarioId, item.secretParameters]),
      );
    }

    return { parameters, secrets: secrets ?? new Map() };
  }

  /**
   * One run per scenario, per target, per repeat — each one's id derived from
   * the batch it belongs to and the slot it occupies, so the same request
   * planned twice plans the same runs.
   */
  private static planItems({
    input,
    batchRunId,
  }: {
    input: SuiteExecutionRequest;
    batchRunId: string;
  }): SuiteExecutionItem[] {
    return input.activeScenarioIds.flatMap((scenarioId) =>
      input.activeTargets.flatMap((target, targetSlot) =>
        Array.from({ length: input.repeatCount }, (_, repeat) => ({
          scenarioId,
          target,
          repeat,
          scenarioRunId: deriveScenarioRunId({ batchRunId, scenarioId, targetSlot, repeat }),
        })),
      ),
    );
  }

  /**
   * Settles rather than races: one scenario failing to queue must not strand
   * the rest of the suite. Answers the items that were queued.
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
  }): Promise<SuiteExecutionItem[]> {
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

    const enqueued = await Promise.allSettled(
      items.map((item) => {
        const targetKey = targetKeyOf(item.target);

        return this.scenarios.queueSimulationRun({
          projectId: input.projectId,
          scenarioId: item.scenarioId,
          scenarioRunId: item.scenarioRunId,
          batchRunId,
          setId,
          name: input.scenarioNames.get(item.scenarioId),
          target: { type: item.target.type, referenceId: item.target.referenceId },
          targetKey,
          ...SuiteExecutionService.withTargetParameters(item.target.runParameters),
          parameters: parameters.get(targetKey)?.get(item.scenarioId) ?? {},
          secretParameters: secrets.get(item.scenarioId) ?? {},
          note: input.note,
          scenarioVersion: input.scenarioVersions.get(item.scenarioId),
          actor: input.actor,
          simulatorModel: input.simulatorModel,
          judgeModel: input.judgeModel,
          resolvedModels: resolvedModelsByScenarioId.get(item.scenarioId) ?? null,
        });
      }),
    );
    SuiteExecutionService.logRejected({ items, enqueued, suiteId: input.suiteId, batchRunId });

    return items.filter((_, index) => enqueued[index]?.status === "fulfilled");
  }

  /** A partial enqueue is otherwise invisible: the batch reads smaller with no record of why. */
  private static logRejected({
    items,
    enqueued,
    suiteId,
    batchRunId,
  }: {
    items: readonly SuiteExecutionItem[];
    enqueued: readonly PromiseSettledResult<unknown>[];
    suiteId: string;
    batchRunId: string;
  }): void {
    enqueued.forEach((result, index) => {
      if (result.status !== "rejected") return;
      logger.error(
        {
          suiteId,
          batchRunId,
          scenarioRunId: items[index]?.scenarioRunId,
          scenarioId: items[index]?.scenarioId,
          error: result.reason,
        },
        "Failed to queue a simulation run; it is left out of the batch",
      );
    });
  }

  /**
   * Only the target's OWN overrides. A target with none records the namespace
   * it always did, so a plain run is not told apart by an empty key.
   */
  private static withTargetParameters(runParameters: SuiteTarget["runParameters"]) {
    return hasParameterOverrides(runParameters) ? { targetParameters: runParameters } : {};
  }
}
