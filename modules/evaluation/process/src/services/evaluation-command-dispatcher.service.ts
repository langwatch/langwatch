import type { ReportEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { EventingCommands } from "@langwatch/eventing";

import type { EvaluationReport } from "../app/evaluation.members.ts";
import type { EvaluationProcessingPipeline } from "./evaluation-processing.service.ts";

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
}
