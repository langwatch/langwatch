import { clearTimeout, setTimeout } from "node:timers";

import { LANGY_CONVERSATION_STATUS, LangyAgentUnavailableError } from "@langwatch/langy-contract";
import { nowInstant } from "@langwatch/time";

import type { LangyTokenBufferRepository } from "../../../repositories/langy-token-buffer.repository.ts";

/** The wait any request gets for a projection it needs (ARCHITECTURE.md, worker semantics). */
const SETTLE_WAIT_MS = 10_000;
const SETTLE_POLL_MS = 250;

/** The refusal once an ended turn's release outlasts the wait: the client retries it. */
export const LANGY_LAST_REPLY_SAVING =
  "Langy is still saving its last reply. Please retry shortly.";

/** What one look at the conversation found: the ended turn still holds it, or the answer. */
export type LangyEndedTurnLook<T> = { kind: "held" } | { kind: "free"; value: T };

/**
 * A turn whose live edge already closed is over for the person: the browser saw its end frame.
 * Its terminal event is folded and its admission released a moment later by subscribers, so a
 * send in that window waits for them instead of being refused as a turn still replying.
 */
export class LangyEndedTurnService {
  static create(deps: {
    tokenBuffer: Pick<LangyTokenBufferRepository, "readTail">;
    waitMs?: number;
    pollMs?: number;
  }): LangyEndedTurnService {
    return new LangyEndedTurnService(
      deps.tokenBuffer,
      deps.waitMs ?? SETTLE_WAIT_MS,
      deps.pollMs ?? SETTLE_POLL_MS,
    );
  }

  private constructor(
    private readonly tokenBuffer: Pick<LangyTokenBufferRepository, "readTail">,
    private readonly waitMs: number,
    private readonly pollMs: number,
  ) {}

  /** Whether the turn's live edge ends on its end or error entry. A read that fails says no. */
  async hasEnded({
    conversationId,
    turnId,
  }: {
    conversationId: string;
    turnId: string;
  }): Promise<boolean> {
    try {
      const { reads } = await this.tokenBuffer.readTail({ conversationId, turnId });
      const last = reads.at(-1)?.entry.type;
      return last === "end" || last === "error";
    } catch {
      return false;
    }
  }

  /** Looks again until the ended turn lets go, or the wait runs out (then the last look). */
  async lookUntilFree<T>(
    look: () => Promise<LangyEndedTurnLook<T>>,
  ): Promise<LangyEndedTurnLook<T>> {
    const deadline = nowInstant().epochMilliseconds + this.waitMs;
    let seen = await look();
    while (seen.kind === "held" && nowInstant().epochMilliseconds < deadline) {
      await this.pause(
        Math.min(this.pollMs, Math.max(deadline - nowInstant().epochMilliseconds, 0)),
      );
      seen = await look();
    }
    return seen;
  }

  /**
   * A conversation read that says RUNNING for another turn whose live edge already ended waits for
   * the fold to let go, and refuses with the retry note once the wait runs out. Others pass as is.
   */
  async settleHeldRead<T extends { status?: string; currentTurnId?: string | null } | null>({
    conversationId,
    admittedTurnId,
    read,
    reread,
  }: {
    conversationId: string;
    admittedTurnId: string;
    read: T;
    reread: () => Promise<T>;
  }): Promise<T> {
    if (read?.status !== LANGY_CONVERSATION_STATUS.RUNNING) return read;
    const heldTurnId = read.currentTurnId;
    if (!heldTurnId || heldTurnId === admittedTurnId) return read;
    if (!(await this.hasEnded({ conversationId, turnId: heldTurnId }))) return read;
    const look = await this.lookUntilFree<T>(async () => {
      const row = await reread();
      if (row?.status === LANGY_CONVERSATION_STATUS.RUNNING) return { kind: "held" as const };
      return { kind: "free" as const, value: row };
    });
    if (look.kind === "held") throw new LangyAgentUnavailableError(LANGY_LAST_REPLY_SAVING);
    return look.value;
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        resolve();
      }, ms);
    });
  }
}
