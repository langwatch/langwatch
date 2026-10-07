import type { EventingCommandSender } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { RecordEvaluatorDeletedCommandData } from "../eventing/evaluator-lifecycle.events.ts";

/** evaluator_lifecycle's senders, bound once the pipeline registers in this process. */
export type EvaluatorLifecycleSenders = Readonly<{
  recordEvaluatorDeleted: Pick<EventingCommandSender<RecordEvaluatorDeletedCommandData>, "send">;
}>;

/** Records evaluator's deletion fact on its own pipeline; monitor reacts from its side. */
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
}
