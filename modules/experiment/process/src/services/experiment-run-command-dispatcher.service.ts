import type {
  CompleteExperimentRunInput,
  ComputeExperimentRunMetricsCommandData,
  RecordEvaluatorResultInput,
  RecordTargetResultInput,
  StartExperimentRunInput,
} from "@langwatch/experiment-contract";

import type { ExecuteExperimentCellCommandData } from "../eventing/experiment-run-cell.commands.ts";
import type {
  AbortRequestedEventData,
  CellFinishedEventData,
  ExperimentRunCompletedEventData,
  ExperimentRunStartedEventData,
  WorkflowEvaluationRequestedEventData,
} from "../eventing/experiment-run-events.process.ts";

type ExperimentRunCommandSender = { send(data: unknown): Promise<unknown> };

/**
 * Private boundary between the canonical Experiment service and the app's
 * Eventing pipeline. The feature owns validation; this only dispatches
 * already-valid commands with their original IDs and timestamps unchanged.
 */
export abstract class ExperimentExecution {
  abstract startExperimentRun(input: StartExperimentRunInput): Promise<void>;
  abstract recordTargetResult(input: RecordTargetResultInput): Promise<void>;
  abstract recordEvaluatorResult(input: RecordEvaluatorResultInput): Promise<void>;
  abstract completeExperimentRun(input: CompleteExperimentRunInput): Promise<void>;
}

/** Refuses execution where the application composes no Eventing pipeline. */
export class UnavailableExperimentExecution extends ExperimentExecution {
  static create(): UnavailableExperimentExecution {
    return new UnavailableExperimentExecution();
  }

  private unavailable(): never {
    throw new Error("Experiment execution is not configured for this application instance");
  }

  async startExperimentRun(_input: StartExperimentRunInput): Promise<void> {
    this.unavailable();
  }

  async recordTargetResult(_input: RecordTargetResultInput): Promise<void> {
    this.unavailable();
  }

  async recordEvaluatorResult(_input: RecordEvaluatorResultInput): Promise<void> {
    this.unavailable();
  }

  async completeExperimentRun(_input: CompleteExperimentRunInput): Promise<void> {
    this.unavailable();
  }
}

/** A command's payload: its event's data inside the envelope every command carries. */
type Enveloped<Data> = Data & { tenantId: string; occurredAt: number };

function isSender(value: unknown): value is ExperimentRunCommandSender {
  if (typeof value !== "object" || value === null || !("send" in value)) return false;

  return typeof value.send === "function";
}

/**
 * The run pipeline's own senders, which exist only once it is registered. A
 * process that hosts no run pipeline refuses by name rather than failing on an
 * undefined sender.
 */
export class ExperimentRunCommandDispatcherService extends ExperimentExecution {
  #senders: Readonly<Record<string, unknown>> | undefined;

  private constructor() {
    super();
  }

  static create(): ExperimentRunCommandDispatcherService {
    return new ExperimentRunCommandDispatcherService();
  }

  /** Binds the registered pipeline's senders. Called once, by the eventing module. */
  connect(commands: Readonly<Record<string, unknown>>): void {
    this.#senders = commands;
  }

  /** Starts a run; a pipeline-driven start also carries its plan. */
  async startExperimentRun(
    input: StartExperimentRunInput | Enveloped<ExperimentRunStartedEventData>,
  ): Promise<void> {
    await this.#send("startExperimentRun", input);
  }

  async recordTargetResult(input: RecordTargetResultInput): Promise<void> {
    await this.#send("recordTargetResult", input);
  }

  async recordEvaluatorResult(input: RecordEvaluatorResultInput): Promise<void> {
    await this.#send("recordEvaluatorResult", input);
  }

  /** Completes a run; the execution manager also names its outcome. */
  async completeExperimentRun(
    input: CompleteExperimentRunInput | Enveloped<ExperimentRunCompletedEventData>,
  ): Promise<void> {
    await this.#send("completeExperimentRun", input);
  }

  async failExperimentCell(input: Enveloped<CellFinishedEventData>): Promise<void> {
    await this.#send("failExperimentCell", input);
  }

  async abortExperimentRun(input: Enveloped<AbortRequestedEventData>): Promise<void> {
    await this.#send("abortExperimentRun", input);
  }

  async executeExperimentCell(input: ExecuteExperimentCellCommandData): Promise<void> {
    await this.#send("executeExperimentCell", input);
  }

  async computeRunMetrics(input: ComputeExperimentRunMetricsCommandData): Promise<void> {
    await this.#send("computeExperimentRunMetrics", input);
  }

  async requestWorkflowEvaluation(
    input: WorkflowEvaluationRequestedEventData & { tenantId: string; occurredAt: number },
  ): Promise<void> {
    await this.#send("requestWorkflowEvaluation", input);
  }

  async #send(name: string, data: unknown): Promise<void> {
    const sender = this.#senders?.[name];
    if (!isSender(sender)) {
      throw new Error(
        `experiment_run_processing registered no "${name}" sender; this process hosts no experiment run pipeline`,
      );
    }

    await sender.send(data);
  }
}
