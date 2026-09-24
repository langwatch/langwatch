import { createLogger } from "@langwatch/observability";
import {
  generateBatchRunId,
  generateScenarioRunId,
  getOnPlatformSetId,
  isInternalSetId,
  ScenarioNotFoundError,
  ScenarioReservedSetIdError,
  ScenarioRunRejectedError,
  type ScenarioApi,
  type ScenarioLaunchRunInput,
  type ScenarioRunScheduled,
} from "@langwatch/scenario-contract";

const logger = createLogger("langwatch:scenario:launch");

export type ScenarioRunLaunchSteps = Pick<
  ScenarioApi,
  "resolveRunParameters" | "prefetchExecution" | "queueSimulationRun"
>;

/**
 * Refuses a run addressed into a set the platform reserves for itself: a run written into a
 * plan's address would move its pass rate, cost and trend.
 */
function assertWritableSetId(params: { setId: string; projectId: string }): void {
  if (!isInternalSetId(params.setId)) return;
  if (params.setId === getOnPlatformSetId(params.projectId)) return;

  throw new ScenarioReservedSetIdError();
}

/** One run of one scenario: resolve its parameters, validate the target, queue it. */
export class ScenarioRunLaunchService {
  private constructor(private readonly steps: ScenarioRunLaunchSteps) {}

  static create(steps: ScenarioRunLaunchSteps): ScenarioRunLaunchService {
    return new ScenarioRunLaunchService(steps);
  }

  async launch(input: ScenarioLaunchRunInput): Promise<ScenarioRunScheduled> {
    const setId = input.setId ?? getOnPlatformSetId(input.projectId);
    assertWritableSetId({ setId, projectId: input.projectId });

    const batchRunId = input.batchRunId ?? generateBatchRunId();

    const resolved = await this.steps
      .resolveRunParameters({
        projectId: input.projectId,
        scenarioId: input.scenarioId,
        values: input.parameters,
      })
      .catch((error: unknown) => {
        // A scenario the run names but the project does not hold has always answered 400 here.
        if (error instanceof ScenarioNotFoundError) {
          throw new ScenarioRunRejectedError(error.message, { reasons: [error] });
        }
        throw error;
      });

    const prefetch = await this.steps.prefetchExecution({
      context: {
        projectId: input.projectId,
        scenarioId: input.scenarioId,
        setId,
        batchRunId,
        parameters: resolved.parameters,
        secretParameters: resolved.secretParameters,
      },
      target: input.target,
    });

    if (!prefetch.success) {
      logger.warn(
        { projectId: input.projectId, scenarioId: input.scenarioId, error: prefetch.error },
        "Scenario validation failed",
      );
      throw new ScenarioRunRejectedError(prefetch.error);
    }

    const scenarioRunId = generateScenarioRunId();

    await this.steps.queueSimulationRun({
      projectId: input.projectId,
      scenarioId: input.scenarioId,
      scenarioRunId,
      batchRunId,
      setId,
      name: prefetch.data.scenario.name,
      target: input.target,
      parameters: resolved.parameters,
      secretParameters: resolved.secretParameters,
      note: input.note,
      scenarioVersion: resolved.scenarioVersion,
      actor: input.actor,
      resolvedModels: prefetch.resolvedModels,
    });

    // The execution subscriber picks the queued event off the group queue and spawns the child.
    logger.info({ batchRunId, scenarioRunId }, "Scenario queued via event-sourcing");

    return { scheduled: true, setId, batchRunId, scenarioRunId };
  }
}
