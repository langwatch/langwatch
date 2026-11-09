import type { EventingCommandSender } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type {
  RecordEvaluatorCreatedCommandData,
  RecordEvaluatorDeletedCommandData,
} from "../eventing/evaluator-lifecycle.commands.ts";

const logger = createLogger("langwatch:evaluator:lifecycle-facts");

/** evaluator_lifecycle's senders, bound once the pipeline registers in this process. */
export type EvaluatorLifecycleSenders = Readonly<{
  recordEvaluatorDeleted: Pick<EventingCommandSender<RecordEvaluatorDeletedCommandData>, "send">;
  recordEvaluatorCreated: Pick<EventingCommandSender<RecordEvaluatorCreatedCommandData>, "send">;
}>;

/**
 * Records evaluator's lifecycle facts on its own pipeline: its creation, and its deletion,
 * which monitor reacts to from its side.
 */
export class EvaluatorDeletionFactsService {
  #senders: EvaluatorLifecycleSenders | undefined;

  static create(): EvaluatorDeletionFactsService {
    return new EvaluatorDeletionFactsService();
  }

  private constructor() {}

  connect(senders: EvaluatorLifecycleSenders): void {
    this.#senders = senders;
  }

  /** Throws when evaluator_lifecycle is not registered here or the record fails. */
  async recordEvaluatorDeleted(input: { projectId: string; evaluatorId: string }): Promise<void> {
    const senders = this.#senders;
    if (!senders) throw new Error("evaluator_lifecycle is not registered in this process");
    await senders.recordEvaluatorDeleted.send({
      tenantId: input.projectId,
      projectId: input.projectId,
      evaluatorId: input.evaluatorId,
      occurredAt: nowInstant().epochMilliseconds,
    });
  }

  /**
   * Records that an evaluator was created, once its row is written. Never throws: the
   * evaluator already exists, so a lost fact is logged rather than failing the create.
   */
  async recordEvaluatorCreated(input: { projectId: string; evaluatorId: string }): Promise<void> {
    const senders = this.#senders;
    if (!senders) return;
    try {
      await senders.recordEvaluatorCreated.send({
        tenantId: input.projectId,
        projectId: input.projectId,
        evaluatorId: input.evaluatorId,
        occurredAt: nowInstant().epochMilliseconds,
      });
    } catch (error) {
      logger.warn(
        { error, evaluatorId: input.evaluatorId, projectId: input.projectId },
        "evaluator created fact was not recorded",
      );
    }
  }
}
