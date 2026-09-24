import type {
  ExecuteEvaluationCommandData,
  ReportEvaluationCommandData,
} from "@langwatch/evaluation-contract";
import type { EventingCommands, QueueSendOptions } from "@langwatch/eventing";

import type { EvaluationReport } from "../app/evaluation.members.ts";
import { ExecuteEvaluationCommand } from "../eventing/evaluation-execution.intent.ts";
import type { EvaluationProcessingPipeline } from "./evaluation-processing.service.ts";

/** Main's trace-trigger dedup: outlasts trace's 5-minute deferred origin window by a minute. */
const TRACE_EVALUATION_DEDUP_TTL_MS = 6 * 60 * 1000;

/**
 * evaluation_processing's own command senders, which exist only once the
 * pipeline is registered. A process that hosts none refuses by name rather
 * than failing on an undefined sender.
 */
export class EvaluationCommandDispatcherService implements EvaluationReport {
  #commands: EventingCommands<EvaluationProcessingPipeline> | undefined;

  private constructor() {}

  static create(): EvaluationCommandDispatcherService {
    return new EvaluationCommandDispatcherService();
  }

  /** Binds the registered pipeline's senders. Called once, by the eventing module. */
  connect(commands: EventingCommands<EvaluationProcessingPipeline>): void {
    this.#commands = commands;
  }

  async reportEvaluation(data: ReportEvaluationCommandData): Promise<void> {
    if (!this.#commands) {
      throw new Error(
        "evaluation_processing registered no reportEvaluation sender; this process hosts no evaluation pipeline",
      );
    }

    await this.#commands.reportEvaluation.send(data);
  }

  async queueTraceEvaluation(data: ExecuteEvaluationCommandData): Promise<void> {
    if (!this.#commands) {
      throw new Error(
        "evaluation_processing registered no executeEvaluation sender; this process hosts no evaluation pipeline",
      );
    }

    await this.#commands.executeEvaluation.send(data, traceEvaluationSendOptions(data));
  }
}

/** A thread-level monitor waits out the thread's idle window; a trace-level one keeps the delay. */
function traceEvaluationSendOptions(
  data: ExecuteEvaluationCommandData,
): QueueSendOptions<ExecuteEvaluationCommandData> {
  const makeId = (payload: ExecuteEvaluationCommandData): string =>
    ExecuteEvaluationCommand.makeJobId(payload);
  const idleMs = (data.threadIdleTimeout ?? 0) * 1000;

  if (idleMs > 0 && data.threadId) {
    return { delay: idleMs, deduplication: { makeId, ttlMs: idleMs, shouldSurviveDispatch: true } };
  }

  return {
    deduplication: { makeId, ttlMs: TRACE_EVALUATION_DEDUP_TTL_MS, shouldSurviveDispatch: true },
  };
}
