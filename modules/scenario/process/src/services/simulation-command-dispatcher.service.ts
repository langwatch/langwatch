import type {
  ComputeRunMetricsCommandData,
  RecordEvaluationsCommandData,
  SimulationCancelRun,
  SimulationDeleteRun,
  SimulationFinishRun,
  SimulationMessageSnapshot,
  SimulationQueueRun,
  SimulationRecordAgentInstance,
  SimulationStartRun,
  SimulationTextMessageEnd,
  SimulationTextMessageStart,
} from "@langwatch/scenario-contract";

import {
  COMPUTE_METRICS_RETRY_DELAY_MS,
  scenarioDeferredComputeRunMetricsJob,
} from "../eventing/compute-run-metrics.commands.ts";
import { SimulationExecutionRepository } from "../repositories/simulation-execution.repository.ts";

type SimulationCommandSender = {
  send(data: unknown, options?: { delay?: number; deduplication?: unknown }): Promise<unknown>;
};

function isSender(value: unknown): value is SimulationCommandSender {
  if (typeof value !== "object" || value === null || !("send" in value)) return false;

  return typeof value.send === "function";
}

/** Retries collapse onto one queue entry per run and trace, as main's deferred job did. */
const COMPUTE_METRICS_RETRY_DEDUP_TTL_MS = 60_000;

/**
 * The simulation write surface, as simulation_processing's own senders, which
 * exist only once the pipeline is registered; before that it refuses by name.
 */
export class SimulationCommandDispatcherService extends SimulationExecutionRepository {
  #senders: Readonly<Record<string, unknown>> | undefined;

  private constructor() {
    super();
  }

  static create(): SimulationCommandDispatcherService {
    return new SimulationCommandDispatcherService();
  }

  /** Binds the registered pipeline's senders. Called once, by the eventing module. */
  connect(commands: Readonly<Record<string, unknown>>): void {
    this.#senders = commands;
  }

  queueRun(input: SimulationQueueRun): Promise<void> {
    return this.#send("queueRun", input);
  }
  startRun(input: SimulationStartRun): Promise<void> {
    return this.#send("startRun", input);
  }
  messageSnapshot(input: SimulationMessageSnapshot): Promise<void> {
    return this.#send("messageSnapshot", input);
  }
  textMessageStart(input: SimulationTextMessageStart): Promise<void> {
    return this.#send("textMessageStart", input);
  }
  textMessageEnd(input: SimulationTextMessageEnd): Promise<void> {
    return this.#send("textMessageEnd", input);
  }
  finishRun(input: SimulationFinishRun): Promise<void> {
    return this.#send("finishRun", input);
  }
  recordEvaluations(input: RecordEvaluationsCommandData): Promise<void> {
    return this.#send("recordEvaluations", input);
  }
  cancelRun(input: SimulationCancelRun): Promise<void> {
    return this.#send("cancelRun", input);
  }
  deleteRun(input: SimulationDeleteRun): Promise<void> {
    return this.#send("deleteRun", input);
  }
  recordAgentInstance(input: SimulationRecordAgentInstance): Promise<void> {
    return this.#send("recordAgentInstance", input);
  }

  computeRunMetrics(input: ComputeRunMetricsCommandData): Promise<void> {
    return this.#send("computeRunMetrics", input);
  }

  /** A pull that found no trace summary yet, asked again after the retry delay. */
  scheduleComputeRunMetricsRetry(input: ComputeRunMetricsCommandData): Promise<void> {
    return this.#send("computeRunMetrics", input, {
      delay: COMPUTE_METRICS_RETRY_DELAY_MS,
      deduplication: {
        makeId: (payload: ComputeRunMetricsCommandData) =>
          scenarioDeferredComputeRunMetricsJob.makeJobId(payload),
        ttlMs: COMPUTE_METRICS_RETRY_DEDUP_TTL_MS,
      },
    });
  }

  async #send(
    name: string,
    data: unknown,
    options?: { delay?: number; deduplication?: unknown },
  ): Promise<void> {
    const sender = this.#senders?.[name];
    if (!isSender(sender)) {
      throw new Error(
        `simulation_processing has not registered its ${name} command in this process, so the write cannot be sent.`,
      );
    }
    await sender.send(data, options);
  }
}
