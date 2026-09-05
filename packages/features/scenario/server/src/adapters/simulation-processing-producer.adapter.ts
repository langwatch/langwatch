/**
 * The `simulation_processing` pipeline as a PRODUCER registers it. One definition, two
 * registrations.
 */
import type { AppendStore, FoldProjectionStore } from "@langwatch/eventing";
import type {
  ScenarioExecutionPrefetchResult,
  SimulationService,
} from "@langwatch/scenario-contract";
import { ScenarioExecutionService } from "@langwatch/scenario-contract";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { SimulationExecutionPort } from "../ports/simulation-execution.port";
import type { SimulationRunMetricsProjectionRecord } from "../projections/simulation-run-metrics.projection";
import type { SimulationRunStateData } from "../projections/simulation-run-state.projection";
import {
  SIMULATION_RUN_EXECUTION_PROCESS_NAME,
  simulationRunExecutionPM,
} from "../processes/simulation-run-execution.process";
import { ComputeRunMetricsCommand } from "./compute-run-metrics.adapter";
import { FinishRunCommand } from "./finish-run.adapter";
import { SimulationClickHouseAdapter } from "./simulation.clickhouse.adapter";
import { SimulationProcessingPipelineAdapter } from "./simulation-processing-pipeline.adapter";

/** Why every stand-in below refuses, in the process's own words. */
function producerOnly(processName: string, capability: string): Error {
  return new Error(
    `${processName} registered the simulation_processing pipeline as a producer only, so it cannot ${capability}. This work belongs to the worker that drains the pipeline.`,
  );
}

/** A fold store that cannot fold, because this process consumes nothing. */
class ProducerOnlyFoldStore<TState> implements FoldProjectionStore<TState> {
  constructor(
    private readonly processName: string,
    private readonly name: string,
  ) {}

  store(): Promise<void> {
    return Promise.reject(producerOnly(this.processName, `write the ${this.name} projection`));
  }

  get(): Promise<TState | null> {
    return Promise.reject(producerOnly(this.processName, `read the ${this.name} projection`));
  }
}

/** An append store that cannot append, for the same reason. */
class ProducerOnlyAppendStore<TRow> implements AppendStore<TRow> {
  constructor(
    private readonly processName: string,
    private readonly name: string,
  ) {}

  append(): Promise<void> {
    return Promise.reject(producerOnly(this.processName, `append to the ${this.name} projection`));
  }
}

/**
 * The run executor the `execute` and `cancel` intents reach.
 */
class ProducerOnlyScenarioExecution extends ScenarioExecutionService {
  constructor(private readonly processName: string) {
    super();
  }

  submit(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "submit a scenario run for execution"));
  }

  cancel(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "cancel a running scenario"));
  }

  prefetch(): Promise<ScenarioExecutionPrefetchResult> {
    return Promise.reject(producerOnly(this.processName, "resolve a scenario run's target"));
  }

  prepare(): never {
    throw producerOnly(this.processName, "prepare a scenario run");
  }

  finishUnsuccessfulRun(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "finish an unsuccessful scenario run"));
  }
}

/**
 * The eight writes, as the process manager's `finish` intent would reach them. This is the seat a
 * REAL dispatcher takes in a producer — the commands the registration itself hands back.
 */
class ProducerOnlySimulationExecution extends SimulationExecutionPort {
  constructor(private readonly processName: string) {
    super();
  }

  queueRun(): Promise<never> {
    return this.refuse("queue a simulation run");
  }
  startRun(): Promise<never> {
    return this.refuse("start a simulation run");
  }
  messageSnapshot(): Promise<never> {
    return this.refuse("record a message snapshot");
  }
  textMessageStart(): Promise<never> {
    return this.refuse("record a message start");
  }
  textMessageEnd(): Promise<never> {
    return this.refuse("record a message end");
  }
  finishRun(): Promise<never> {
    return this.refuse("finish a simulation run");
  }
  cancelRun(): Promise<never> {
    return this.refuse("cancel a simulation run");
  }
  deleteRun(): Promise<never> {
    return this.refuse("delete a simulation run");
  }

  private refuse(capability: string): Promise<never> {
    return Promise.reject(producerOnly(this.processName, capability));
  }
}

/**
 * Builds the simulation-processing definition for a process that only sends commands on it.
 * `processName` names the refusal, so a stand-in reached by accident says which process reached it
 * rather than reporting an anonymous failure.
 */
function buildSimulationProcessingProducerPipeline(input: { processName: string }) {
  const { processName } = input;
  const execution = new ProducerOnlySimulationExecution(processName);
  const simulations: SimulationService = SimulationClickHouseAdapter.createNull({ execution });

  return SimulationProcessingPipelineAdapter.create({
    simulationRunStore: new ProducerOnlyFoldStore<SimulationRunStateData>(
      processName,
      "simulation run state",
    ),
    simulationRunMetricsStore: new ProducerOnlyAppendStore<SimulationRunMetricsProjectionRecord>(
      processName,
      "simulation run metrics",
    ),
    finishRunCommand: new FinishRunCommand({
      loadPriorEvents: () => Promise.reject(producerOnly(processName, "read a run's prior events")),
    }),
    computeRunMetricsCommand: new ComputeRunMetricsCommand({
      traceSummaryStore: new ProducerOnlyFoldStore<TraceSummaryData>(processName, "trace summary"),
      scheduleRetry: () => Promise.reject(producerOnly(processName, "schedule a metrics retry")),
      deriveScenarioRoleMetrics: () =>
        Promise.reject(producerOnly(processName, "derive per-role scenario metrics")),
    }),
    scenarioRunExecution: {
      name: SIMULATION_RUN_EXECUTION_PROCESS_NAME,
      process: simulationRunExecutionPM(
        new ProducerOnlyScenarioExecution(processName),
        simulations,
      ),
    },
    simulations,
    snapshotUpdateBroadcast: {
      broadcastUpdate: () =>
        Promise.reject(producerOnly(processName, "broadcast a simulation update")),
    },
    suiteRunSync: {
      recordSuiteRunItemStarted: () =>
        Promise.reject(producerOnly(processName, "record a suite run item start")),
      completeSuiteRunItem: () =>
        Promise.reject(producerOnly(processName, "complete a suite run item")),
    },
    traceMetricsSync: {
      computeRunMetrics: () =>
        Promise.reject(producerOnly(processName, "compute a run's trace metrics")),
    },
  });
}

/** The simulation-processing definition as a command-only producer sees it. */
export class SimulationProcessingProducerAdapter {
  static create(options: { processName: string }): SimulationProcessingProducerAdapter {
    return new SimulationProcessingProducerAdapter(options);
  }

  private constructor(private readonly options: { processName: string }) {}

  build() {
    return buildSimulationProcessingProducerPipeline(this.options);
  }
}
