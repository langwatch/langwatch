import {
  LangyConversationNotOwnedError,
  LangyTurnNotStoppableError,
} from "@langwatch/langy-contract";
import {
  reconstructPartialAnswer,
  type LangyTurnServiceDependencies,
} from "./langy-turn.shared";

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
    const { tokenBuffer, worker, conversations, accessStore } = this.deps;
    const isActor = accessStore
      ? await accessStore.isTurnActor({
          projectId,
          conversationId,
          turnId,
          userId,
        })
      : false;
    if (!isActor) {
      const conversation = await conversations.tryFindByIdVisible({
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

    const partialText = tokenBuffer
      ? await reconstructPartialAnswer(tokenBuffer, { conversationId, turnId })
      : "";
    await conversations.finalizeTurn({
      projectId,
      conversationId,
      turnId,
      parts: this.deps.finalParts.build({ text: partialText }),
      outcome: "stopped",
    });
    await Promise.allSettled([
      tokenBuffer?.markEnd({ conversationId, turnId }) ?? Promise.resolve(),
      worker?.cancel({ conversationId, turnId, projectId }) ?? Promise.resolve(),
    ]);
  }
}
