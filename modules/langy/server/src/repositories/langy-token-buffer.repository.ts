import type { LangyStreamEntry } from "@langwatch/langy-contract";

/** An entry paired with the Redis stream id it was read at. */
export interface LangyStreamRead {
  id: string;
  entry: LangyStreamEntry;
}

/**
 * The minimal Redis surface the buffer uses. Injected so unit tests can drive a fake without a
 * live server; production adapts the shared ioredis connection. `blocking` is a duplicated
 * connection dedicated to `XREAD BLOCK` so a follow read never wedges the shared client.
 */
export interface LangyStreamRedis {
  xadd(key: string, ...args: (string | number)[]): Promise<string | null>;
  xrange(key: string, start: string, end: string): Promise<Array<[string, string[]]>>;
  expire(key: string, seconds: number): Promise<number>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  /** Dedicated connection for blocking reads. Falls back to `this` if absent. */
  blocking?: {
    xread(
      ...args: (string | number)[]
    ): Promise<Array<[string, Array<[string, string[]]>]>> | null | Promise<null>;
  };
}

/**
 * The live edge of one turn: the ordered, TTL'd stream a worker writes tokens and ticks onto,
 * and a reader replays then follows.
 * A seam because the durability split is the point (ADR-044 part 3): what is
 */
export abstract class LangyTokenBufferPort {
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
export type LangyTokenBufferConnection = { redis: unknown; blockingRedis?: unknown };
