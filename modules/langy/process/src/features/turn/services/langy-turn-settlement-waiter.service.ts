import { clearTimeout, setTimeout } from "node:timers";

import {
  extractLangyTextFromParts,
  LANGY_CONVERSATION_TURN_STATUS,
  LangyConversationNotFoundError,
  type LangyConversationTurnData,
  type LangyTurnSettlement,
  type LangyTurnSettlementWait,
} from "@langwatch/langy-contract";

import type { LangyTokenBufferRepository } from "../../../repositories/langy-token-buffer.repository.ts";
import { turnMessageId } from "../../../rules/langy-conversation-shape.rules.ts";

/** The turn-state projection, read for a caller who may see the conversation. */
export type LangyTurnSettlementReader = {
  findTurn(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    userId: string;
  }): Promise<LangyConversationTurnData[]>;
};

/** One turn's live edge over a borrowed blocking connection; `release` gives it back. */
export type LangyTurnBufferWatch = { buffer: LangyTokenBufferRepository; release: () => void };
export type OpenLangyTurnBuffer = () => LangyTurnBufferWatch;

const bufferedPollMs = 5_000;
const fallbackPollMs = 750;
const confirmPollMs = 250;

/** Holding a request open until one turn settles, from the turn projection and the live edge. */
export class LangyTurnSettlementWaiterService {
  static create(): LangyTurnSettlementWaiterService {
    return new LangyTurnSettlementWaiterService();
  }

  private constructor() {}

  abortableDelay(ms: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) {
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve(false);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve(true);
      }, ms);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** How the turn ended, once its projection says it has. */
  private settlementFromTurn(turn: LangyConversationTurnData): LangyTurnSettlement | null {
    switch (turn.Status) {
      case LANGY_CONVERSATION_TURN_STATUS.COMPLETED:
      case LANGY_CONVERSATION_TURN_STATUS.STOPPED: {
        return {
          succeeded: true,
          outcome: turn.Status,
          text: extractLangyTextFromParts(turn.AnswerParts),
          messageId: turnMessageId(turn.TurnId),
          parts: turn.AnswerParts,
          error: null,
        };
      }
      case LANGY_CONVERSATION_TURN_STATUS.FAILED: {
        return {
          succeeded: false,
          outcome: "failed",
          text: null,
          error: turn.Error ?? "Turn failed",
        };
      }
      default: {
        return null;
      }
    }
  }

  /** The card the turn is waiting on, as its question prose (empty for a permission card). */
  private userWaitFromTurn(turn: LangyConversationTurnData): LangyTurnSettlementWait | null {
    const wait = turn.ToolCalls.find((call) => call.wait?.status === "pending")?.wait;
    if (!wait) {
      return null;
    }

    const questions = Array.isArray(wait.questions) ? wait.questions : [];
    return {
      kind: "awaiting_user",
      question: questions
        .map((entry) =>
          entry &&
          typeof entry === "object" &&
          "question" in entry &&
          typeof entry.question === "string"
            ? entry.question
            : "",
        )
        .filter((question) => question.length > 0)
        .join("\n"),
    };
  }

  /** A reply always wins over a card: the card is answered only while the turn is still open. */
  private async readSettlementFromTurn(input: {
    langy: LangyTurnSettlementReader;
    projectId: string;
    conversationId: string;
    turnId: string;
    userId: string;
    shouldSettleOnUserWait?: boolean;
  }): Promise<LangyTurnSettlementWait | null> {
    const [turn] = await input.langy
      .findTurn({
        projectId: input.projectId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        userId: input.userId,
      })
      .catch((error: unknown) => {
        if (error instanceof LangyConversationNotFoundError) {
          return [];
        }

        throw error;
      });
    if (!turn) {
      return null;
    }

    const settlement = this.settlementFromTurn(turn);
    if (settlement) {
      return { kind: "settled", settlement };
    }

    return input.shouldSettleOnUserWait ? this.userWaitFromTurn(turn) : null;
  }

  private neverSettles(): Promise<never> {
    return new Promise<never>(() => {});
  }

  private isTerminalFrame(entry: { type: string }): boolean {
    return entry.type === "end" || entry.type === "error";
  }

  private async watchBufferForTerminal(
    buffer: LangyTokenBufferRepository,
    input: { conversationId: string; turnId: string; signal: AbortSignal },
  ): Promise<void> {
    const { reads, lastId } = await buffer.readTail({
      conversationId: input.conversationId,
      turnId: input.turnId,
    });
    if (reads.some(({ entry }) => this.isTerminalFrame(entry))) {
      return;
    }

    for await (const { entry } of buffer.follow({
      conversationId: input.conversationId,
      turnId: input.turnId,
      fromId: lastId,
      signal: input.signal,
    })) {
      if (this.isTerminalFrame(entry)) {
        return;
      }
    }

    await this.neverSettles();
  }

  private armBufferWatch(input: {
    openBuffer: OpenLangyTurnBuffer;
    conversationId: string;
    turnId: string;
    signal: AbortSignal;
  }): { terminalSeen: Promise<void> | null; release: () => void } {
    const { buffer, release } = input.openBuffer();

    return {
      terminalSeen: this.watchBufferForTerminal(buffer, input).catch(() => this.neverSettles()),
      release,
    };
  }

  private async waitForNextPoll(
    terminalSeen: Promise<void> | null,
    pollMs: number,
    signal: AbortSignal,
  ): Promise<"tick" | "terminal" | "abort"> {
    const delay: Promise<"tick" | "abort"> = this.abortableDelay(pollMs, signal).then(
      (completed): "tick" | "abort" => (completed ? "tick" : "abort"),
    );
    if (!terminalSeen) {
      return delay;
    }

    const terminal: Promise<"terminal"> = terminalSeen.then((): "terminal" => "terminal");

    return Promise.race([terminal, delay]);
  }

  async awaitTurnSettlement(input: {
    langy: LangyTurnSettlementReader;
    openBuffer: OpenLangyTurnBuffer;
    projectId: string;
    conversationId: string;
    turnId: string;
    userId: string;
    signal: AbortSignal;
    pollIntervalMs?: number;
    shouldSettleOnUserWait?: boolean;
  }): Promise<LangyTurnSettlementWait> {
    const armed = this.armBufferWatch(input);
    let terminalSeen = armed.terminalSeen;
    let pollMs = terminalSeen ? bufferedPollMs : (input.pollIntervalMs ?? fallbackPollMs);

    try {
      while (!input.signal.aborted) {
        const settlement = await this.readSettlementFromTurn(input);
        if (settlement) {
          return settlement;
        }

        const outcome = await this.waitForNextPoll(terminalSeen, pollMs, input.signal);
        if (outcome === "abort") {
          return { kind: "stopped" };
        }

        if (outcome === "terminal") {
          terminalSeen = null;
          pollMs = confirmPollMs;
        }
      }

      return { kind: "stopped" };
    } finally {
      armed.release();
    }
  }
}
