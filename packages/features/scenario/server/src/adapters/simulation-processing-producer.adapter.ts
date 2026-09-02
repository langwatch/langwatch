/**
 * The `simulation_processing` pipeline as a PRODUCER registers it.
 *
 * One definition, two registrations. The consumer — the worker — supplies the
 * real run-state fold, the metrics map, the trace-summary reads behind
 * `computeRunMetrics`, the three cross-feature subscribers and the run-execution
 * process manager, and drains every routing key the definition declares. A
 * producer registers the SAME definition only to obtain its command
 * dispatchers: the eight writes a customer's action turns into, off a tRPC
 * call, and nothing else. It starts no consumer loop, holds no event log, folds
 * nothing and runs no process manager.
 *
 * Every dependency the definition takes is consumer-side, and a producer has
 * none of them. That is what this module supplies — stand-ins that exist so the
 * definition can be CONSTRUCTED and refuse by name if they are ever CALLED.
 * Refusing rather than no-op'ing is the whole point: a silently-succeeding fold
 * store in a process that was never meant to fold would report a projection as
 * written when nothing was, and the row would simply never appear.
 *
 * THE PROCESS MANAGER IS DECLARED HERE AND RUN THERE. `simulation_processing`
 * mounts `simulation_run_execution`, and the runtime used to refuse to register
 * any pipeline declaring one without a durable `ProcessStore` — which made all
 * eight commands unsendable from the tier a customer's action actually arrives
 * at. A producer-only runtime registers the definition whole and declines the
 * manager by name instead (`EventSourcingOptions.processManagerMode`), so the
 * inbox, outbox and wakes stay the consumer's alone.
 *
 * Forking the definition instead — declaring only the commands a producer
 * sends — is the thing this avoids. The routing triple every job carries is
 * derived from the pipeline and command names, so two descriptions of one event
 * stream drift into jobs the worker cannot route.
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
 *
 * Unreachable here by construction — a producer runs no process manager, so
 * neither intent is ever leased — and it refuses anyway, so a graph that
 * somehow mounted one says which process it reached rather than submitting a
 * run into a pool that does not exist.
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
 * The eight writes, as the process manager's `finish` intent would reach them.
 *
 * This is the seat a REAL dispatcher takes in a producer — the commands the
 * registration itself hands back. It is a refusal here because the definition
 * has to be constructed before those dispatchers exist, and because a producer
 * never leases the intent that would use it.
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
 * Builds the simulation-processing definition for a process that only sends
 * commands on it.
 *
 * `processName` names the refusal, so a stand-in reached by accident says which
 * process reached it rather than reporting an anonymous failure.
 */
export function createSimulationProcessingProducerPipeline(input: { processName: string }) {
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
