import type { LangyStreamEntry } from "@langwatch/langy-contract";
import type { Redis } from "ioredis";

/** An entry paired with the Redis stream id it was read at. */
export interface LangyStreamRead {
  id: string;
  entry: LangyStreamEntry;
}

/** The Redis commands the buffer uses on the shared connection. */
export type LangyStreamRedis = Pick<Redis, "xadd" | "xrange" | "expire" | "set" | "get" | "xread">;

/** A duplicated connection for `XREAD BLOCK`, so a follow read never wedges the shared one. */
export type LangyStreamBlockingRedis = Pick<Redis, "xread">;

/**
 * The live edge of one turn: the ordered, TTL'd stream a worker writes tokens and ticks onto,
 * and a reader replays then follows.
 * A seam because the durability split is the point (ADR-044 part 3): what is
 */
export abstract class LangyTokenBuffer {
  /** Every entry written so far, with the id to follow from. */
  abstract readTail(input: {
    conversationId: string;
    turnId: string;
  }): Promise<{ reads: LangyStreamRead[]; lastId: string }>;

  /** Entries after `fromId`, blocking until the turn ends or the signal aborts. */
  abstract follow(input: {
    conversationId: string;
    turnId: string;
    fromId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<LangyStreamRead, void, void>;

  /**
   * Closes the turn's stream. `backstopSilentTurn` substitutes
   * {@link LANGY_EMPTY_TURN_FALLBACK} for a turn that wrote no visible text.
   */
  abstract markEnd(input: {
    conversationId: string;
    turnId: string;
    backstopSilentTurn?: boolean;
  }): Promise<{ backstopped: boolean; text?: string }>;

  /** Puts one local call's permission card on the live edge (ADR-129). */
  abstract appendLocalPermission(input: {
    conversationId: string;
    turnId: string;
    entry: Omit<Extract<LangyStreamEntry, { type: "local_permission" }>, "type">;
  }): Promise<void>;

  /** Puts a question card on the live edge. */
  abstract appendQuestion(input: {
    conversationId: string;
    turnId: string;
    entry: Omit<Extract<LangyStreamEntry, { type: "question" }>, "type">;
  }): Promise<void>;

  /** Puts the shared folder's connect or disconnect on the live edge. */
  abstract appendLocalWorkspace(input: {
    conversationId: string;
    turnId: string;
    entry: Omit<Extract<LangyStreamEntry, { type: "local_workspace" }>, "type">;
  }): Promise<void>;

  /** Mirrors one UI action onto the live edge. */
  abstract appendUiAction(input: {
    conversationId: string;
    turnId: string;
    actionId: string;
    kind: string;
    payload: unknown;
  }): Promise<void>;

  /** Ephemeral "major update" — which tool/action the agent is picking. */
  abstract appendStatus(input: {
    conversationId: string;
    turnId: string;
    status: string;
  }): Promise<void>;

  /** Refreshes the per-turn liveness key. */
  abstract heartbeat(input: {
    conversationId: string;
    turnId: string;
    now?: number;
  }): Promise<void>;
}

/** The connection a stream's blocking tail borrows, handed to `open()` below. */
export type LangyTokenBufferConnection = {
  redis: LangyStreamRedis;
  blockingRedis?: LangyStreamBlockingRedis;
};
