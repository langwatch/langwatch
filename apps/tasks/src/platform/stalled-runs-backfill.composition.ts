import { NullSimulationRepository, SimulationService } from "@langwatch/scenario-server";
import { SimulationStalledRunAdapter } from "@langwatch/scenario-server/composition/simulation-eventing";
import { SimulationExecutionRepository } from "@langwatch/scenario-server/composition/simulation-execution-port";
import { SimulationProcessingProducerAdapter } from "@langwatch/scenario-server/composition/simulation-processing-producer";
import { StalledRunsBackfillTask } from "@langwatch/scenario-server/composition/stalled-runs-backfill";
import { nowInstant } from "@langwatch/time";
import {
  ScenarioExecutionService,
  ScenarioRunStatus,
  buildFailureResults,
  type ScenarioExecutionJob,
  type ScenarioExecutionPrefetchInput,
  type ScenarioExecutionPrefetchResult,
  type ScenarioExecutionPreparation,
  type ScenarioUnsuccessfulExecutionInput,
  type SimulationCancelRun,
  type SimulationRecordAgentInstance,
  type SimulationDeleteRun,
  type SimulationFinishRun,
  type SimulationMessageSnapshot,
  type SimulationQueueRun,
  type SimulationStartRun,
  type SimulationTextMessageEnd,
  type SimulationTextMessageStart,
} from "@langwatch/scenario-contract";
import {
  TASKS_PROCESS_NAME,
  type TasksEventingInfrastructure,
} from "./tasks-eventing.composition.ts";
import type { TasksHost } from "./tasks-host.composition.ts";

/**
 * The eight simulation writes, dispatched onto this process's own producer-only registration.
 * Only `finishRun` is ever called by stalled-runs-backfill; the rest refuse by name — this task
 * submits and cancels nothing, and streams no messages.
 */
class TasksSimulationExecution extends SimulationExecutionRepository {
  constructor(
    private readonly finishRunCommand: { send(input: SimulationFinishRun): Promise<void> },
  ) {
    super();
  }

  finishRun(input: SimulationFinishRun): Promise<void> {
    return this.finishRunCommand.send(input);
  }

  private refuse(capability: string): Promise<never> {
    return Promise.reject(
      new Error(`stalled-runs-backfill never dispatches ${capability}; only finishRun is wired.`),
    );
  }

  queueRun(_input: SimulationQueueRun): Promise<void> {
    return this.refuse("queueRun");
  }
  startRun(_input: SimulationStartRun): Promise<void> {
    return this.refuse("startRun");
  }
  messageSnapshot(_input: SimulationMessageSnapshot): Promise<void> {
    return this.refuse("messageSnapshot");
  }
  textMessageStart(_input: SimulationTextMessageStart): Promise<void> {
    return this.refuse("textMessageStart");
  }
  textMessageEnd(_input: SimulationTextMessageEnd): Promise<void> {
    return this.refuse("textMessageEnd");
  }
  cancelRun(_input: SimulationCancelRun): Promise<void> {
    return this.refuse("cancelRun");
  }
  deleteRun(_input: SimulationDeleteRun): Promise<void> {
    return this.refuse("deleteRun");
  }
  recordAgentInstance(_input: SimulationRecordAgentInstance): Promise<void> {
    return this.refuse("recordAgentInstance");
  }
}

/** Completes historical stalled runs without resolving a target or starting execution. */
class TasksScenarioExecution extends ScenarioExecutionService {
  constructor(private readonly simulations: SimulationService) {
    super();
  }

  finishUnsuccessfulRun(input: ScenarioUnsuccessfulExecutionInput): Promise<void> {
    if (input.target) {
      throw new Error("Stalled-run backfill cannot classify a live execution target.");
    }

    return this.simulations.finishRun({
      tenantId: input.projectId,
      scenarioRunId: input.scenarioRunId,
      occurredAt: nowInstant().epochMilliseconds,
      status: input.cancelled ? ScenarioRunStatus.CANCELLED : ScenarioRunStatus.ERROR,
      results: buildFailureResults({
        cancelled: input.cancelled ?? false,
        error: input.error,
        targetHasDevTunnel: false,
      }),
    });
  }

  private refuse(capability: string): Promise<never> {
    return Promise.reject(
      new Error(
        `stalled-runs-backfill never dispatches ${capability}; only finishUnsuccessfulRun is wired.`,
      ),
    );
  }

  submit(_input: ScenarioExecutionJob): Promise<void> {
    return this.refuse("submit");
  }
  cancel(_input: { projectId: string; scenarioRunId: string }): Promise<void> {
    return this.refuse("cancel");
  }
  prefetch(_input: ScenarioExecutionPrefetchInput): Promise<ScenarioExecutionPrefetchResult> {
    return this.refuse("prefetch");
  }
  prepare(_input: ScenarioExecutionPrefetchInput): ScenarioExecutionPreparation {
    throw new Error(
      "stalled-runs-backfill never dispatches prepare; only finishUnsuccessfulRun is wired.",
    );
  }
  recordAgentInstance(): Promise<void> {
    return this.refuse("recordAgentInstance");
  }
}

/**
 * Builds the `stalled-runs-backfill` task, deferred to `run()` — the same reason
 * `object-storage-migrate.composition.ts` defers: constructing the real `execution`
 * registers an Eventing pipeline, which needs Redis.
 */
export function buildStalledRunsBackfillTask({
  host,
  eventing,
}: {
  host: TasksHost;
  eventing: TasksEventingInfrastructure | undefined;
}): StalledRunsBackfillTask {
  return StalledRunsBackfillTask.create({
    dryRun: process.env.STALLED_RUNS_BACKFILL_DRY_RUN === "true",
    finder: () => SimulationStalledRunAdapter.create(host.requireClickhouse()),
    execution: () => {
      if (!eventing) {
        throw new Error(
          "stalled-runs-backfill requires REDIS_URL: finishUnsuccessfulRun dispatches finishRun through a producer-only Eventing pipeline over Group Queue.",
        );
      }
      const registered = eventing.eventSourcing.register(
        SimulationProcessingProducerAdapter.create({ processName: TASKS_PROCESS_NAME }).build(),
      );
      const simulations = SimulationService.create(
        new NullSimulationRepository(),
        new TasksSimulationExecution(registered.commands.finishRun),
      );
      return new TasksScenarioExecution(simulations);
    },
  });
}
