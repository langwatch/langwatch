import type { LangyMessagePart } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";

import type { LangyFinalPartsService } from "./langy-final-parts.service.ts";
import type { LangyTurnOrderReader, LangyTurnSegment } from "./langy-turn-order.service.ts";

const turnServiceLogger = createLogger("langwatch:langy:conversation-service");

type LangyTurnAccountReaderOptions = {
  turnOrder: LangyTurnOrderReader | null;
  finalParts: LangyFinalPartsService;
};

export class LangyTurnAccountReaderService {
  static create(deps: LangyTurnAccountReaderOptions): LangyTurnAccountReaderService {
    return new LangyTurnAccountReaderService(deps);
  }

  private constructor(private readonly deps: LangyTurnAccountReaderOptions) {}

  /**
   * The turn's own account of what happened, folded off its live stream.
   * Read here since two paths finalize a turn (relay + agent HTTP post)
   * and whichever lands first wins. Best effort: a failed read still records what it can.
   */
  async readTurnOrder(at: { conversationId: string; turnId: string }): Promise<LangyTurnSegment[]> {
    if (!this.deps.turnOrder) {
      return [];
    }

    try {
      return await this.deps.turnOrder.readTurnOrder(at);
    } catch (error) {
      turnServiceLogger.warn(
        { ...at, error },
        "could not read a turn's order; recording its calls before its reply",
      );

      return [];
    }
  }

  /**
   * The parts a failed turn left on its live stream. Best effort like the order read: a lapsed
   * buffer or a failed read records the failure without a message, which is what a failed turn
   * always recorded.
   */
  async failedTurnParts(at: {
    conversationId: string;
    turnId: string;
  }): Promise<LangyMessagePart[]> {
    if (!this.deps.turnOrder) {
      return [];
    }

    try {
      const account = await this.deps.turnOrder.readTurnAccount(at);
      const saidSomething = account.order.some(
        (segment) => segment.kind === "text" && segment.text.trim() !== "",
      );
      if (account.toolCalls.length === 0 && !saidSomething) {
        return [];
      }

      return this.deps.finalParts.build({
        text: account.closingText,
        toolCalls: account.toolCalls,
        ...(account.order.length > 0 ? { order: account.order } : {}),
      });
    } catch (error) {
      turnServiceLogger.warn(
        { ...at, error },
        "could not read a failed turn's account; recording the failure without a message",
      );

      return [];
    }
  }
}
