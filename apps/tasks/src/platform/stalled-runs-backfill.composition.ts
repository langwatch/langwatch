import { AgentService } from "@langwatch/agent-contract";
import {
  createSimulationProcessingProducerPipeline,
  ScenarioFailureHandlerService,
  SimulationClickHouseAdapter,
  SimulationExecutionPort,
  SimulationStalledRunAdapter,
  StalledRunsBackfillTask,
} from "@langwatch/scenario-server";
import {
  ScenarioExecutionService,
  type ScenarioExecutionJob,
  type ScenarioExecutionPrefetchInput,
  type ScenarioExecutionPrefetchResult,
  type ScenarioExecutionPreparation,
  type ScenarioUnsuccessfulExecutionInput,
  type SimulationCancelRun,
  type SimulationDeleteRun,
  type SimulationFinishRun,
  type SimulationMessageSnapshot,
  type SimulationQueueRun,
  type SimulationStartRun,
  type SimulationTextMessageEnd,
  type SimulationTextMessageStart,
} from "@langwatch/scenario-contract";
import { TASKS_PROCESS_NAME, type TasksEventingInfrastructure } from "./tasks-eventing.composition";
import type { TasksHost } from "./tasks-host.composition";

/**
 * `finishUnsuccessfulRun` only reads `AgentService` when the input carries a
 * `target`, and this task's finder never resolves one — so the lookup never
 * fires. Every method still refuses by name rather than composing the Agent
 * feature into this process for a read it cannot reach.
 */
class UnreachableTasksAgentService extends AgentService {
  private refuse(capability: string): Promise<never> {
    return Promise.reject(
      new Error(
        `apps/tasks composes no Agent feature; ${capability} is unreachable from stalled-runs-backfill.`,
      ),
    );
  }

  getById(): Promise<never> {
    return this.refuse("getById");
  }
  getAll(): Promise<never> {
    return this.refuse("getAll");
  }
  getReferenceStates(): Promise<never> {
    return this.refuse("getReferenceStates");
  }
  getNamesByIds(): Promise<never> {
    return this.refuse("getNamesByIds");
  }
  exists(): Promise<never> {
    return this.refuse("exists");
  }
  list(): Promise<never> {
    return this.refuse("list");
  }
  create(): Promise<never> {
    return this.refuse("create");
  }
  update(): Promise<never> {
    return this.refuse("update");
  }
  archive(): Promise<never> {
    return this.refuse("archive");
  }
  relatedEntities(): Promise<never> {
    return this.refuse("relatedEntities");
  }
  cascadeArchive(): Promise<never> {
    return this.refuse("cascadeArchive");
  }
  getCopies(): Promise<never> {
    return this.refuse("getCopies");
  }
  getSourceOfCopy(): Promise<never> {
    return this.refuse("getSourceOfCopy");
  }
  copy(): Promise<never> {
    return this.refuse("copy");
  }
  pushToCopies(): Promise<never> {
    return this.refuse("pushToCopies");
  }
  syncFromSource(): Promise<never> {
    return this.refuse("syncFromSource");
  }
  getHistory(): Promise<never> {
    return this.refuse("getHistory");
  }
  registerConnected(): Promise<never> {
    return this.refuse("registerConnected");
  }
  ownersOf(): Promise<never> {
    return this.refuse("ownersOf");
  }
  getConnectedByNameAndEnvironment(): Promise<never> {
    return this.refuse("getConnectedByNameAndEnvironment");
  }
}

/**
 * The eight simulation writes, dispatched onto this process's own
 * producer-only registration. Only `finishRun` is ever called by
 * stalled-runs-backfill; the rest refuse by name — this task submits and
 * cancels nothing, and streams no messages.
 */
class TasksSimulationExecution extends SimulationExecutionPort {
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
}

/**
 * Wraps `ScenarioFailureHandlerService` as a `ScenarioExecutionService`: the
 * task's only reachable capability is `finishUnsuccessfulRun`, and the
 * other four belong to the run EXECUTOR — a pool this process never composes.
 */
class TasksScenarioExecution extends ScenarioExecutionService {
  constructor(private readonly failures: ScenarioFailureHandlerService) {
    super();
  }

  finishUnsuccessfulRun(input: ScenarioUnsuccessfulExecutionInput): Promise<void> {
    return this.failures.finishUnsuccessfulRun(input);
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
}

/**
 * Builds the `stalled-runs-backfill` task, deferred to `run()` — the same
 * reason `object-storage-migrate.composition.ts` defers: constructing the
 * real `execution` registers an Eventing pipeline, which needs Redis, and a
 * missing `REDIS_URL` must fail only THIS task, at run time, not every other
 * task at catalogue construction.
 */
export function buildStalledRunsBackfillTask({
  host,
  eventing,
}: {
  host: TasksHost;
  eventing: TasksEventingInfrastructure | undefined;
}): StalledRunsBackfillTask {
  return StalledRunsBackfillTask.create({
    finder: () => SimulationStalledRunAdapter.create(host.requireClickhouse()),
    execution: () => {
      if (!eventing) {
        throw new Error(
          "stalled-runs-backfill requires REDIS_URL: finishUnsuccessfulRun dispatches finishRun through a producer-only Eventing pipeline over Group Queue.",
        );
      }
      const registered = eventing.eventSourcing.register(
        createSimulationProcessingProducerPipeline({ processName: TASKS_PROCESS_NAME }),
      );
      const simulations = SimulationClickHouseAdapter.createNull({
        execution: new TasksSimulationExecution(registered.commands.finishRun),
      });
      return new TasksScenarioExecution(
        ScenarioFailureHandlerService.create({
          agents: new UnreachableTasksAgentService(),
          simulations,
        }),
      );
    },
  });
}
