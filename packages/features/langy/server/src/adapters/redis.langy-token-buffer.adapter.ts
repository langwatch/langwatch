/**
 * Langy token buffer: the short-lived Redis transport for a turn's live edge
 * (ADR-044 part 3). Tokens and progress ticks live only here, never as
 * durable events (ADR-044 part 2).
 */

import {
  LANGY_LIVENESS,
  LANGY_STREAM,
  LANGY_STREAMING,
} from "../rules/langy-streaming-constants.rules";
import type { CliResultDigest, CliToolResult, LangyStreamEntry } from "@langwatch/langy-contract";
import {
  langyEmptyTurnLine,
  type LangyStreamRead,
  type LangyStreamRedis,
  LangyTokenBufferPort,
} from "../ports/langy-token-buffer.port";

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

export class LangyTokenBufferAdapter extends LangyTokenBufferPort {
  private readonly redis: LangyStreamRedis;
  /** Per-turn token accumulator, flushed on the hybrid size/time policy. */
  private readonly pending = new Map<string, string>();
  private readonly tokenCounts = new Map<string, number>();
  /** Turns whose FIRST delta already flushed (time-to-first-token done). */
  private readonly firstFlushDone = new Set<string>();
  /**
   * Turns that emitted at least one delta with a non-whitespace character.
   * Separate from `firstFlushDone`: a whitespace-only delta still must be
   * buffered, though it leaves nothing for the panel to show.
   */
  private readonly sawVisibleText = new Set<string>();
  /** Per-turn time-arm timers: flush pending text FLUSH_AFTER_MS after the first pending token. */
  private readonly flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Reasoning is live-only too, but model providers may stream it token by token. */
  private readonly pendingReasoning = new Map<string, string>();
  private readonly reasoningFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private constructor(deps: { redis: LangyStreamRedis }) {
    super();
    this.redis = deps.redis;
  }

  static create(deps: { redis: unknown; blockingRedis?: unknown }): LangyTokenBufferAdapter {
    const redis = deps.redis as LangyStreamRedis;
    if (deps.blockingRedis) {
      redis.blocking = deps.blockingRedis as LangyStreamRedis["blocking"];
    }
    return new LangyTokenBufferAdapter({ redis });
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
   * Buffers a token delta with a hybrid flush policy: the first delta of a
   * turn flushes immediately, then flushes on a size or time threshold.
   * Call `flush` at end-of-turn to drain the tail.
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
    if (text.trim()) this.sawVisibleText.add(pk);
    this.pending.set(pk, (this.pending.get(pk) ?? "") + text);
    // Cheap word-count proxy — we do not tokenize here.
    const count = (this.tokenCounts.get(pk) ?? 0) + (text.split(/\s+/).length || 1);
    this.tokenCounts.set(pk, count);

    // Time-to-first-token: the turn's first delta goes straight out.
    if (!this.firstFlushDone.has(pk)) {
      this.firstFlushDone.add(pk);
      await this.flush({ conversationId, turnId });
      return;
    }

    // Size arm.
    if (count >= LANGY_STREAMING.CHUNK_TOKENS) {
      await this.flush({ conversationId, turnId });
      return;
    }

    // Time arm: armed once per pending batch, cleared by any flush.
    if (!this.flushTimers.has(pk)) {
      const timer = setTimeout(() => {
        this.flushTimers.delete(pk);
        // Best-effort: a failed timed flush leaves the text pending for the
        // next size/terminal flush rather than crashing an unhandled timer.
        void this.flush({ conversationId, turnId }).catch(() => undefined);
      }, LANGY_STREAMING.FLUSH_AFTER_MS);
      timer.unref?.();
      this.flushTimers.set(pk, timer);
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
    const timer = this.flushTimers.get(pk);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(pk);
    }
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

  /**
   * Push the permission card of one local call onto the live edge. Flushes the
   * buffered tokens first, like every other card append, so the line that
   * announces the command lands before the card that asks about it.
   */
  async appendLocalPermission({
    conversationId,
    turnId,
    entry,
  }: {
    conversationId: string;
    turnId: string;
    entry: Omit<Extract<LangyStreamEntry, { type: "local_permission" }>, "type">;
  }): Promise<void> {
    await this.flush({ conversationId, turnId });
    await this.append(conversationId, turnId, {
      type: "local_permission",
      ...entry,
    });
  }

  /** Push a question card onto the live edge. */
  async appendQuestion({
    conversationId,
    turnId,
    entry,
  }: {
    conversationId: string;
    turnId: string;
    entry: Omit<Extract<LangyStreamEntry, { type: "question" }>, "type">;
  }): Promise<void> {
    await this.flush({ conversationId, turnId });
    await this.append(conversationId, turnId, { type: "question", ...entry });
  }

  /** Push the shared folder's connect or disconnect onto the live edge. */
  async appendLocalWorkspace({
    conversationId,
    turnId,
    entry,
  }: {
    conversationId: string;
    turnId: string;
    entry: Omit<Extract<LangyStreamEntry, { type: "local_workspace" }>, "type">;
  }): Promise<void> {
    await this.flush({ conversationId, turnId });
    await this.append(conversationId, turnId, {
      type: "local_workspace",
      ...entry,
    });
  }

  /**
   * Ephemeral run of the model's reasoning (thinking). Live edge ONLY — it is
   * never flushed to the durable final and never survives a reload; the browser
   * shows it while it streams and drops it when the turn settles. Providers can
   * emit reasoning one token at a time, so coalesce it on the same short cadence
   * as visible answer text. That avoids rerendering the entire panel per token
   * without making the thinking indicator feel delayed.
   */
  async appendReasoning({
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
    this.pendingReasoning.set(pk, (this.pendingReasoning.get(pk) ?? "") + text);
    if (this.reasoningFlushTimers.has(pk)) return;
    const timer = setTimeout(() => {
      this.reasoningFlushTimers.delete(pk);
      void this.flushReasoning({ conversationId, turnId }).catch(() => undefined);
    }, LANGY_STREAMING.FLUSH_AFTER_MS);
    timer.unref?.();
    this.reasoningFlushTimers.set(pk, timer);
  }

  /** Flush the coalesced live reasoning tail, including before a terminal marker. */
  private async flushReasoning({
    conversationId,
    turnId,
  }: {
    conversationId: string;
    turnId: string;
  }): Promise<void> {
    const pk = this.pendingKey(conversationId, turnId);
    const timer = this.reasoningFlushTimers.get(pk);
    if (timer) {
      clearTimeout(timer);
      this.reasoningFlushTimers.delete(pk);
    }
    const text = this.pendingReasoning.get(pk);
    if (!text) return;
    this.pendingReasoning.delete(pk);
    await this.append(conversationId, turnId, { type: "reasoning", text });
  }

  /**
   * Mirrors a plan snapshot onto the live stream (whole-list, last wins);
   * the durable `plan_updated` event is dispatched separately. Flushes
   * buffered tokens first so the checklist lands in order.
   */
  async appendPlan({
    conversationId,
    turnId,
    items,
  }: {
    conversationId: string;
    turnId: string;
    items: Array<{ content: string; status: string }>;
  }): Promise<void> {
    await this.flush({ conversationId, turnId });
    await this.append(conversationId, turnId, { type: "plan", items });
  }

  /** Ephemeral "sub update" — how far through a subtask the agent is. */
  async appendProgress({
    conversationId,
    turnId,
    message,
    progress,
    current,
    total,
    batchItems,
    batchDurationMs,
  }: {
    conversationId: string;
    turnId: string;
    message?: string;
    progress?: number;
    current?: number;
    total?: number;
    batchItems?: number;
    batchDurationMs?: number;
  }): Promise<void> {
    await this.append(conversationId, turnId, {
      type: "progress",
      ...(message !== undefined ? { message } : {}),
      ...(progress !== undefined ? { progress } : {}),
      ...(current !== undefined ? { current } : {}),
      ...(total !== undefined ? { total } : {}),
      ...(batchItems !== undefined ? { batchItems } : {}),
      ...(batchDurationMs !== undefined ? { batchDurationMs } : {}),
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
   * Pushes a live-only navigate instruction; `href` is already resolved to a
   * same-app path by the caller. Fires at most once on the live edge, never
   * as a durable event, flushing buffered tokens first.
   */
  async appendNavigate({
    conversationId,
    turnId,
    href,
  }: {
    conversationId: string;
    turnId: string;
    href: string;
  }): Promise<void> {
    await this.flush({ conversationId, turnId });
    await this.append(conversationId, turnId, { type: "navigate", href });
  }

  /**
   * Pushes a live-only UI action for the attached page to claim and execute;
   * the caller has already validated `kind`, `payload`, and pinned the
   * action to this turn. Fires at most once, never as a durable event.
   */
  async appendUiAction({
    conversationId,
    turnId,
    actionId,
    kind,
    payload,
  }: {
    conversationId: string;
    turnId: string;
    actionId: string;
    kind: string;
    payload: unknown;
  }): Promise<void> {
    await this.flush({ conversationId, turnId });
    await this.append(conversationId, turnId, {
      type: "ui",
      actionId,
      kind,
      payload,
    });
  }

  /**
   * Mirrors a tool-call transition onto the live stream: `phase:"start"` on
   * invoke, `phase:"end"` on return. Flushes buffered tokens first so the
   * card lands after the prose that preceded it.
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
    digest,
    result,
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
    digest?: CliResultDigest;
    result?: CliToolResult;
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
      ...(digest !== undefined ? { digest } : {}),
      ...(result !== undefined ? { result } : {}),
    });
  }

  /**
   * Terminal marker: the live stream is over. Flushes buffered tokens first.
   * `backstopSilentTurn` asks for the empty-turn fallback line, which only a
   * genuinely completed turn (never a Stop or an ADR-048 handoff) may ask.
   */
  async markEnd({
    conversationId,
    turnId,
    backstopSilentTurn = false,
  }: {
    conversationId: string;
    turnId: string;
    backstopSilentTurn?: boolean;
  }): Promise<{ backstopped: boolean; text?: string }> {
    await this.flush({ conversationId, turnId });
    await this.flushReasoning({ conversationId, turnId });
    // A turn that completes without a text delta leaves a finished spinner and
    // nothing else, which reads as a broken product even when every command in
    // the turn succeeded. The agent is told to always end with visible text;
    // this is the backstop. Pure whitespace reads the same as nothing, so it
    // takes the fallback too.
    //
    // The stream also decides WHICH line: a turn holding on a card is waiting
    // for the reader, not failing to answer them.
    //
    // The tail is what decides both, not `sawVisibleText`: that map is in
    // memory and a buffer is built per relay request, so a worker that
    // reconnected mid-turn ends the stream on an instance that never saw the
    // earlier deltas. Only read when instance memory says nothing was written,
    // which is the rare case, so the normal path pays no read.
    let backstopped = false;
    let text: string | undefined;
    if (backstopSilentTurn && !this.sawVisibleText.has(this.pendingKey(conversationId, turnId))) {
      const { reads } = await this.readTail({ conversationId, turnId });
      const entries = reads.map((read) => read.entry);
      const visible = entries.some((entry) => entry.type === "delta" && entry.text.trim() !== "");
      if (!visible) {
        backstopped = true;
        text = langyEmptyTurnLine(entries);
        await this.append(conversationId, turnId, { type: "delta", text });
      }
    }
    this.firstFlushDone.delete(this.pendingKey(conversationId, turnId));
    this.sawVisibleText.delete(this.pendingKey(conversationId, turnId));
    await this.append(conversationId, turnId, { type: "end" });
    return { backstopped, ...(text !== undefined ? { text } : {}) };
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
    await this.flushReasoning({ conversationId, turnId });
    this.firstFlushDone.delete(this.pendingKey(conversationId, turnId));
    this.sawVisibleText.delete(this.pendingKey(conversationId, turnId));
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
   * Async iterator over the live edge from `fromId`, ending after the
   * terminal entry is delivered. Each `XREAD BLOCK` waits up to
   * FOLLOW_BLOCK_MS then re-checks, so a caller can bound total wait.
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
      ).xread("BLOCK", LANGY_STREAMING.FOLLOW_BLOCK_MS, "STREAMS", key, cursor)) as Array<
        [string, Array<[string, string[]]>]
      > | null;
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
