/**
 * Langy token buffer — the short-lived Redis transport for a turn's live edge
 * (ADR-044 part 3).
 *
 * Durability split: TOKENS and transient progress ticks live ONLY here (a Redis
 * Stream with a TTL); they NEVER become durable events. Milestones and the
 * final answer are durable events on the `langy_conversation` aggregate.
 *
 * Why a Redis Stream (not List + pub/sub): one primitive gives ordered ids +
 * gap-free replay (`XRANGE`) + a live blocking read (`XREAD BLOCK`), so a chunk
 * emitted between "replay the tail" and "attach live" is never lost — the
 * pub/sub race the plan calls out. The reader captures the last-seen id from the
 * tail replay and blocks from there.
 *
 * The heartbeat key (`langy:hb:{conv}:{turn}`) is a separate TTL key: a live
 * worker refreshes it; a dead pod's key lapses. Authoritative liveness is the
 * TTL, not the event log (ADR-044 part 2).
 */

import { LANGY_STREAM, LANGY_STREAMING, LANGY_LIVENESS } from "./langy.streaming.constants";

/**
 * A decoded stream entry. `delta` carries buffered tokens; `status`/`progress`
 * are ephemeral live-only ticks; `milestone` mirrors a durable milestone to the
 * live UI (the durable event is dispatched separately); `end`/`error` are
 * terminal markers the reader stops on.
 */
export type LangyStreamEntry =
  | { type: "delta"; text: string }
  | { type: "status"; status: string }
  | { type: "progress"; message?: string; progress?: number }
  | { type: "milestone"; kind: string; detail?: string }
  // A tool call the agent ran, mirrored onto the live edge so the UI renders a
  // card as the tool starts and updates it when it returns. `phase:"start"`
  // carries the name + input; `phase:"end"` carries the result (`output`, a
  // string) and `isError`. The durable `tool_call_started`/`tool_call_completed`
  // events are dispatched separately (this is best-effort live UI, not the
  // source of truth).
  | {
      type: "tool";
      id: string;
      name: string;
      phase: "start" | "end";
      title?: string;
      input?: unknown;
      output?: string;
      isError?: boolean;
    }
  | { type: "end" }
  | { type: "error"; error: string };

/** An entry paired with the Redis stream id it was read at. */
export interface LangyStreamRead {
  id: string;
  entry: LangyStreamEntry;
}

/**
 * The minimal Redis surface the buffer uses. Injected so unit tests can drive a
 * fake without a live server; production adapts the shared ioredis connection.
 * `blocking` is a duplicated connection dedicated to `XREAD BLOCK` so a follow
 * read never wedges the shared client.
 */
export interface LangyStreamRedis {
  xadd(key: string, ...args: (string | number)[]): Promise<string | null>;
  xrange(
    key: string,
    start: string,
    end: string,
  ): Promise<Array<[string, string[]]>>;
  expire(key: string, seconds: number): Promise<number>;
  set(
    key: string,
    value: string,
    mode: "EX",
    ttl: number,
  ): Promise<unknown>;
  get(key: string): Promise<string | null>;
  /** Dedicated connection for blocking reads. Falls back to `this` if absent. */
  blocking?: {
    xread(
      ...args: (string | number)[]
    ): Promise<Array<[string, Array<[string, string[]]>]>> | null | Promise<null>;
  };
}

const PAYLOAD_FIELD = "p";

function encode(entry: LangyStreamEntry): string {
  return JSON.stringify(entry);
}

function decodeFields(fields: string[]): LangyStreamEntry | null {
  // Fields arrive as a flat [name, value, name, value, ...] array. We only
  // write a single `p` field, so find it and JSON-decode.
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i] === PAYLOAD_FIELD) {
      try {
        return JSON.parse(fields[i + 1]!) as LangyStreamEntry;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export class LangyTokenBuffer {
  private readonly redis: LangyStreamRedis;
  /** Per-turn token accumulator, flushed to the stream every CHUNK_TOKENS. */
  private readonly pending = new Map<string, string>();
  private readonly tokenCounts = new Map<string, number>();

  constructor(deps: { redis: LangyStreamRedis }) {
    this.redis = deps.redis;
  }

  private streamKey(conversationId: string, turnId: string): string {
    return LANGY_STREAM.streamKey(conversationId, turnId);
  }

  private heartbeatKey(conversationId: string, turnId: string): string {
    return LANGY_STREAM.heartbeatKey(conversationId, turnId);
  }

  private pendingKey(conversationId: string, turnId: string): string {
    return `${conversationId}:${turnId}`;
  }

  private async append(
    conversationId: string,
    turnId: string,
    entry: LangyStreamEntry,
  ): Promise<void> {
    const key = this.streamKey(conversationId, turnId);
    await this.redis.xadd(
      key,
      "MAXLEN",
      "~",
      LANGY_STREAMING.STREAM_MAXLEN,
      "*",
      PAYLOAD_FIELD,
      encode(entry),
    );
    // TTL is refreshed on every append so an active turn's buffer never lapses
    // mid-stream, but a finished/abandoned turn's buffer self-cleans.
    await this.redis.expire(key, LANGY_STREAMING.STREAM_TTL_SECONDS);
  }

  /**
   * Buffer a token delta. Flushes a single `delta` entry once ~CHUNK_TOKENS
   * words have accumulated, bounding XADD volume on a fast stream while staying
   * responsive. Call `flush` at end-of-turn to drain the tail.
   */
  async appendChunk({
    conversationId,
    turnId,
    text,
  }: {
    conversationId: string;
    turnId: string;
    text: string;
  }): Promise<void> {
    if (!text) return;
    const pk = this.pendingKey(conversationId, turnId);
    this.pending.set(pk, (this.pending.get(pk) ?? "") + text);
    // Cheap word-count proxy — we do not tokenize here.
    const count =
      (this.tokenCounts.get(pk) ?? 0) + (text.split(/\s+/).length || 1);
    this.tokenCounts.set(pk, count);
    if (count >= LANGY_STREAMING.CHUNK_TOKENS) {
      await this.flush({ conversationId, turnId });
    }
  }

  /** Flush any buffered tokens for a turn as a single `delta` entry. */
  async flush({
    conversationId,
    turnId,
  }: {
    conversationId: string;
    turnId: string;
  }): Promise<void> {
    const pk = this.pendingKey(conversationId, turnId);
    const text = this.pending.get(pk);
    if (!text) return;
    this.pending.delete(pk);
    this.tokenCounts.delete(pk);
    await this.append(conversationId, turnId, { type: "delta", text });
  }

  /** Ephemeral "major update" — which tool/action the agent is picking. */
  async appendStatus({
    conversationId,
    turnId,
    status,
  }: {
    conversationId: string;
    turnId: string;
    status: string;
  }): Promise<void> {
    await this.append(conversationId, turnId, { type: "status", status });
  }

  /** Ephemeral "sub update" — how far through a subtask the agent is. */
  async appendProgress({
    conversationId,
    turnId,
    message,
    progress,
  }: {
    conversationId: string;
    turnId: string;
    message?: string;
    progress?: number;
  }): Promise<void> {
    await this.append(conversationId, turnId, {
      type: "progress",
      ...(message !== undefined ? { message } : {}),
      ...(progress !== undefined ? { progress } : {}),
    });
  }

  /**
   * Mirror a durable milestone onto the live stream so a currently-attached
   * client renders it immediately. The durable event is dispatched separately;
   * this is best-effort UI, not the source of truth.
   */
  async appendMilestone({
    conversationId,
    turnId,
    kind,
    detail,
  }: {
    conversationId: string;
    turnId: string;
    kind: string;
    detail?: string;
  }): Promise<void> {
    await this.append(conversationId, turnId, {
      type: "milestone",
      kind,
      ...(detail !== undefined ? { detail } : {}),
    });
  }

  /**
   * Mirror a tool-call transition onto the live stream. `phase:"start"` when the
   * agent invokes a tool (name + input known), `phase:"end"` when it returns
   * (`output` + `isError`). Flushes any buffered tokens first so the card lands
   * after the prose that preceded it, in order.
   */
  async appendTool({
    conversationId,
    turnId,
    id,
    name,
    phase,
    title,
    input,
    output,
    isError,
  }: {
    conversationId: string;
    turnId: string;
    id: string;
    name: string;
    phase: "start" | "end";
    title?: string;
    input?: unknown;
    output?: string;
    isError?: boolean;
  }): Promise<void> {
    await this.flush({ conversationId, turnId });
    await this.append(conversationId, turnId, {
      type: "tool",
      id,
      name,
      phase,
      ...(title !== undefined ? { title } : {}),
      ...(input !== undefined ? { input } : {}),
      ...(output !== undefined ? { output } : {}),
      ...(isError !== undefined ? { isError } : {}),
    });
  }

  /** Terminal marker: the turn completed. Flushes buffered tokens first. */
  async markEnd({
    conversationId,
    turnId,
  }: {
    conversationId: string;
    turnId: string;
  }): Promise<void> {
    await this.flush({ conversationId, turnId });
    await this.append(conversationId, turnId, { type: "end" });
  }

  /** Terminal marker: the turn errored. Flushes buffered tokens first. */
  async markError({
    conversationId,
    turnId,
    error,
  }: {
    conversationId: string;
    turnId: string;
    error: string;
  }): Promise<void> {
    await this.flush({ conversationId, turnId });
    await this.append(conversationId, turnId, { type: "error", error });
  }

  /** Refresh the per-turn liveness key. TTL = 2× the heartbeat interval. */
  async heartbeat({
    conversationId,
    turnId,
    now = Date.now(),
  }: {
    conversationId: string;
    turnId: string;
    now?: number;
  }): Promise<void> {
    await this.redis.set(
      this.heartbeatKey(conversationId, turnId),
      String(now),
      "EX",
      LANGY_LIVENESS.heartbeatTtlSeconds(),
    );
  }

  /**
   * Read the buffered tail from the beginning. Returns every entry plus the id
   * of the last one — the caller passes that id to `follow` so the live read
   * resumes exactly where the tail ended (closes the replay→attach gap).
   */
  async readTail({
    conversationId,
    turnId,
  }: {
    conversationId: string;
    turnId: string;
  }): Promise<{ reads: LangyStreamRead[]; lastId: string }> {
    const key = this.streamKey(conversationId, turnId);
    const rows = await this.redis.xrange(key, "-", "+");
    const reads: LangyStreamRead[] = [];
    let lastId = "0";
    for (const [id, fields] of rows) {
      const entry = decodeFields(fields);
      if (entry) reads.push({ id, entry });
      lastId = id;
    }
    return { reads, lastId };
  }

  /**
   * Async iterator over the live edge from `fromId`, ending after the terminal
   * (`end`/`error`) entry is delivered. Each `XREAD BLOCK` waits up to
   * FOLLOW_BLOCK_MS then re-checks, so a caller can bound total wait / observe
   * an aborted signal between blocks.
   */
  async *follow({
    conversationId,
    turnId,
    fromId,
    signal,
  }: {
    conversationId: string;
    turnId: string;
    fromId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<LangyStreamRead, void, void> {
    const key = this.streamKey(conversationId, turnId);
    const reader = this.redis.blocking ?? this.redis;
    let cursor = fromId;
    while (!signal?.aborted) {
      const res = (await (
        reader as {
          xread(
            ...args: (string | number)[]
          ): Promise<Array<[string, Array<[string, string[]]>]>> | null;
        }
      ).xread(
        "BLOCK",
        LANGY_STREAMING.FOLLOW_BLOCK_MS,
        "STREAMS",
        key,
        cursor,
      )) as Array<[string, Array<[string, string[]]>]> | null;
      if (!res) continue; // block timed out; loop re-checks the abort signal
      for (const [, rows] of res) {
        for (const [id, fields] of rows) {
          cursor = id;
          const entry = decodeFields(fields);
          if (!entry) continue;
          yield { id, entry };
          if (entry.type === "end" || entry.type === "error") return;
        }
      }
    }
  }

  /**
   * Liveness of a turn: whether a fresh heartbeat exists. `stale` when the key
   * is absent OR its timestamp is older than the grace window.
   */
  async liveness({
    conversationId,
    turnId,
    now = Date.now(),
    graceMs = LANGY_LIVENESS.HEARTBEAT_GRACE_MS,
  }: {
    conversationId: string;
    turnId: string;
    now?: number;
    graceMs?: number;
  }): Promise<{ present: boolean; stale: boolean; lastBeatAt: number | null }> {
    const raw = await this.redis.get(this.heartbeatKey(conversationId, turnId));
    if (raw == null) return { present: false, stale: true, lastBeatAt: null };
    const lastBeatAt = Number(raw);
    if (!Number.isFinite(lastBeatAt)) {
      return { present: true, stale: true, lastBeatAt: null };
    }
    return {
      present: true,
      stale: now - lastBeatAt >= graceMs,
      lastBeatAt,
    };
  }
}

/**
 * Adapt the shared ioredis connection (or a duplicate for blocking reads) to the
 * `LangyStreamRedis` shape. The blocking connection is optional; when omitted,
 * `follow` uses the primary (fine for tests, not for a busy shared client).
 */
export function createLangyTokenBuffer(deps: {
  redis: unknown;
  blockingRedis?: unknown;
}): LangyTokenBuffer {
  const redis = deps.redis as LangyStreamRedis;
  if (deps.blockingRedis) {
    redis.blocking = deps.blockingRedis as LangyStreamRedis["blocking"];
  }
  return new LangyTokenBuffer({ redis });
}
