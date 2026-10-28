import {
  LangyConversationNotOwnedError,
  LangyTurnNotStoppableError,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";

import { type LangyTurnServiceDependencies } from "./langy-turn-shared.service.ts";
import { LangyTurnSharedService } from "./langy-turn-shared.service.ts";

const logger = createLogger("langwatch:langy:turn-stop-service");

/** The shared turn helpers. Stateless: one instance for the module. */
const LANGY_TURN_SHARED = LangyTurnSharedService.create();

/** Private control collaborator for the durable Stop workflow. */
export class LangyTurnStopService {
  private constructor(private readonly deps: LangyTurnServiceDependencies) {}

  static create(deps: LangyTurnServiceDependencies): LangyTurnStopService {
    return new LangyTurnStopService(deps);
  }

  async stopTurn({
    projectId,
    conversationId,
    turnId,
    userId,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    userId: string;
  }): Promise<void> {
    const { tokenBuffer, worker, conversations, accessStore, localWork } = this.deps;
    const isActor = await accessStore.isTurnActor({
      projectId,
      conversationId,
      turnId,
      userId,
    });
    if (!isActor) {
      const conversation = await conversations.findByIdVisible({
        id: conversationId,
        projectId,
        userId,
      });
      if (!conversation?.isOwn) {
        throw new LangyConversationNotOwnedError(conversationId);
      }

      if (conversation.currentTurnId !== turnId) {
        throw new LangyTurnNotStoppableError(turnId);
      }
    }

    // Before the terminal, so a dispatch racing this stop reads the marker
    // rather than the handoff alone: a turn can be admitted (and its handoff
    // stashed) seconds before any worker runs it, and the outbox re-drives that
    // handoff on its own schedule. Best-effort — the durable terminal below is
    // what makes the stop true, and a Redis blip may not hold it up.
    await this.deps.handoffStore.markStopped({ conversationId, turnId }).catch((error: unknown) => {
      logger.warn(
        { error, projectId, conversationId, turnId },
        "could not record the langy stop marker; a redrive may still dispatch this turn",
      );
    });

    const partialText = await LANGY_TURN_SHARED.reconstructPartialAnswer(tokenBuffer, {
      conversationId,
      turnId,
    });
    await conversations.finalizeTurn({
      projectId,
      conversationId,
      turnId,
      parts: this.deps.finalParts.build({ text: partialText }),
      outcome: "stopped",
    });
    // Best-effort, after the terminal. The worker's abort only ends its own polling: the card
    // and the command the turn left on the developer's machine end here (ADR-129).
    const settled = await Promise.allSettled([
      tokenBuffer.markEnd({ conversationId, turnId }),
      worker?.cancel({ conversationId, turnId, projectId }) ?? Promise.resolve(),
      Promise.resolve().then(() => localWork.cancelTurn({ conversationId, turnId })),
    ]);
    for (const outcome of settled) {
      if (outcome.status !== "rejected") continue;
      logger.warn(
        { error: outcome.reason, projectId, conversationId, turnId },
        "part of the langy stop failed after the stopped terminal was recorded",
      );
    }
  }
}
