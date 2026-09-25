import type {
  CompleteExperimentRunInput,
  ComputeExperimentRunMetricsCommandData,
  RecordEvaluatorResultInput,
  RecordTargetResultInput,
  StartExperimentRunInput,
} from "@langwatch/experiment-contract";

import type { WorkflowEvaluationRequestedEventData } from "../eventing/experiment-run-events.process.ts";
import { ExperimentExecution } from "./experiment.service.ts";

type ExperimentRunCommandSender = { send(data: unknown): Promise<unknown> };

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

  async startExperimentRun(input: StartExperimentRunInput): Promise<void> {
    await this.#send("startExperimentRun", input);
  }

  async recordTargetResult(input: RecordTargetResultInput): Promise<void> {
    await this.#send("recordTargetResult", input);
  }

  async recordEvaluatorResult(input: RecordEvaluatorResultInput): Promise<void> {
    await this.#send("recordEvaluatorResult", input);
  }

  async completeExperimentRun(input: CompleteExperimentRunInput): Promise<void> {
    await this.#send("completeExperimentRun", input);
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
