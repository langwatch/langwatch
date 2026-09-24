import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EventingParticipation, PriorEventsRead, ResourceOwnership } from "@langwatch/kernel";
import {
  SCENARIO_WORKER,
  type SimulationProcessingEvent,
  type SimulationService,
} from "@langwatch/scenario-contract";
import type { TraceApi } from "@langwatch/trace-contract";

import type { CancellationPublisher } from "../app/scenario.app.ts";
import { ComputeRunMetricsCommand } from "../eventing/compute-run-metrics.commands.ts";
import { FinishRunCommand } from "../eventing/finish-run.commands.ts";
import { RecordEvaluationsCommand } from "../eventing/record-evaluations.commands.ts";
import {
  SimulationProcessingPipelineAdapter,
  type SimulationProcessingPipelineDefinition,
} from "../eventing/simulation-processing.pipeline.ts";
import {
  SIMULATION_RUN_EXECUTION_PROCESS_NAME,
  simulationRunExecutionPM,
} from "../eventing/simulation-run-execution.process.ts";
import type { SnapshotUpdateBroadcastSubscriberDeps } from "../eventing/snapshot-update-broadcast.subscriber.ts";
import type { SuiteRunSyncSubscriberDeps } from "../eventing/suite-run-sync.subscriber.ts";
import type { SimulationRunProcessingRepository } from "../repositories/simulation-run-processing.repository.ts";
import { isSimulationProcessingEvent } from "../rules/simulation-run-event.rules.ts";
import { ScenarioExecutionPoolService } from "./scenario-execution-pool.service.ts";
import type { ScenarioExecutorService } from "./scenario-executor.service.ts";
import { ScenarioRunDispatchService } from "./scenario-run-dispatch.service.ts";
import type { SimulationCommandDispatcherService } from "./simulation-command-dispatcher.service.ts";

export type SimulationTraceReads = Pick<TraceApi, "findSummary" | "deriveScenarioRoleMetrics">;

/** What simulation_processing's `build` is handed by the process. */
export interface SimulationPipelineSetup {
  readonly participation: EventingParticipation;
  readonly priorEvents?: PriorEventsRead;
  /** Where the consuming executor registers its drain. */
  readonly resources?: Pick<ResourceOwnership, "own">;
}

/**
 * simulation_processing, ported from main's worker composition: run fold and
 * metrics over scenario's repositories, ECST commands reading the run's own
 * earlier events, and the execution pool built only on consume (WP-5 ruling 3).
 */
export class SimulationProcessingService {
  private constructor(
    private readonly input: {
      runs: SimulationRunProcessingRepository;
      cancellations: CancellationPublisher;
      traces: SimulationTraceReads;
      retention: Pick<DataRetentionApi, "getPlatformDefaultRetentionDays">;
      commands: SimulationCommandDispatcherService;
      simulations: SimulationService;
      suiteRuns: SuiteRunSyncSubscriberDeps;
      snapshotUpdates: SnapshotUpdateBroadcastSubscriberDeps;
      executor: ScenarioExecutorService;
    },
  ) {}

  static create(input: {
    runs: SimulationRunProcessingRepository;
    cancellations: CancellationPublisher;
    traces: SimulationTraceReads;
    retention: Pick<DataRetentionApi, "getPlatformDefaultRetentionDays">;
    commands: SimulationCommandDispatcherService;
    simulations: SimulationService;
    suiteRuns: SuiteRunSyncSubscriberDeps;
    snapshotUpdates: SnapshotUpdateBroadcastSubscriberDeps;
    executor: ScenarioExecutorService;
  }): SimulationProcessingService {
    return new SimulationProcessingService(input);
  }

  buildPipeline(setup: SimulationPipelineSetup): SimulationProcessingPipelineDefinition {
    const { runs, cancellations, traces, retention, commands, simulations } = this.input;
    const loadPriorEvents = this.#priorEventsLoader(setup.priorEvents);
    const pool =
      setup.participation === "consume"
        ? ScenarioExecutionPoolService.create({ concurrency: SCENARIO_WORKER.CONCURRENCY })
        : void 0;
    if (pool) this.input.executor.connect({ pool, resources: setup.resources });

    return SimulationProcessingPipelineAdapter.create({
      simulationRunStore: runs.runStateStore({
        defaultRetentionDays: () => retention.getPlatformDefaultRetentionDays(),
      }),
      simulationRunMetricsStore: runs.runMetricsStore(),
      finishRunCommand: new FinishRunCommand({ loadPriorEvents }),
      recordEvaluationsCommand: new RecordEvaluationsCommand({ loadPriorEvents }),
      computeRunMetricsCommand: new ComputeRunMetricsCommand({
        traceSummaryStore: {
          get: async (traceId, context) => {
            const summary = await traces.findSummary({
              projectId: String(context.tenantId),
              traceId,
            });
            return summary ? { kind: "folded", state: summary } : { kind: "empty" };
          },
        },
        scheduleRetry: (payload) => commands.scheduleComputeRunMetricsRetry(payload),
        deriveScenarioRoleMetrics: (params) => traces.deriveScenarioRoleMetrics(params),
      }),
      scenarioRunExecution: {
        name: SIMULATION_RUN_EXECUTION_PROCESS_NAME,
        process: simulationRunExecutionPM(
          ScenarioRunDispatchService.create({ pool, cancellations }),
          simulations,
        ),
      },
      simulations,
      snapshotUpdateBroadcast: this.input.snapshotUpdates,
      suiteRunSync: this.input.suiteRuns,
      traceMetricsSync: { computeRunMetrics: (data) => commands.computeRunMetrics(data) },
    });
  }

  #priorEventsLoader(
    priorEvents: PriorEventsRead | undefined,
  ): (params: {
    tenantId: string;
    scenarioRunId: string;
  }) => Promise<readonly SimulationProcessingEvent[]> {
    return ({ tenantId, scenarioRunId }) => {
      if (!priorEvents) {
        return Promise.reject(
          new Error(
            `simulation_processing reads run ${scenarioRunId}'s earlier events, but this process handed it no event log.`,
          ),
        );
      }
      return priorEvents({
        tenantId,
        aggregateId: scenarioRunId,
        accepts: isSimulationProcessingEvent,
      });
    };
  }
}
