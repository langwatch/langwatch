import {
  applyLangyTurnEvents,
  initialLangyTurnProjection,
  seedLangyTurnProjection,
  type LangyConversationTurnWireEvent,
  type LangyEventCursor,
  type LangyTurnProjectionState,
} from "@langwatch/langy";
import { create } from "zustand";
import type { LangyStreamEntry } from "~/server/app-layer/langy/streaming/langyTokenBuffer";
import { useLangyStore } from "./langyStore";

/**
 * The developer drawer's record of what actually crossed the wire — in BOTH
 * directions, on every channel.
 *
 * Langy's UI is several layers of interpretation stacked on one stream: the
 * transport maps entries to AI-SDK chunks, the chunks become message parts, the
 * parts become cards, and signals fork off into the store to drive status lines
 * and fold motion. When something renders wrong, the question is always the same
 * one — "what did the server actually send?" — and until now the honest answer
 * required a breakpoint.
 *
 * So this is the raw tape, one ring of records across four LANES:
 *
 *   stream    INBOUND. Every `LangyStreamEntry` off the live turn stream, in
 *             arrival order — tokens, tool frames, signals, terminals.
 *   outbound  OUTBOUND. What this client asked the server to do — the sent
 *             message, the stop request — so "did we even send it?" and "in
 *             what order relative to the stream?" are on the same tape.
 *   durable   INBOUND. The EVENT LOG itself (ADR-059): the recorded events the
 *             tail fetch returns and the snapshot seeds, i.e. the durable truth
 *             the local fold is built from. This lane is REPLAYABLE — see
 *             {@link replayTurnProjection}.
 *   signal    INBOUND. The freshness signals, with their cursors — the "you
 *             may be behind" pokes that trigger the tail fetches.
 *
 * No interpretation, no filtering.
 *
 * ── COSTS NOTHING WHEN OFF ─────────────────────────────────────────────────
 * Every `record*()` returns immediately unless recording is armed, and arming
 * is done by the drawer itself (developer mode). A user who never opens it pays
 * one boolean check per wire entry — on a stream that is already doing a React
 * render per token.
 *
 * ── BOUNDED ────────────────────────────────────────────────────────────────
 * A long agentic turn emits thousands of deltas. The tape is a RING BUFFER
 * capped at {@link DEV_LOG_CAPACITY}: past the cap the oldest entries drop and
 * `dropped` counts them, so the drawer can say so rather than quietly implying
 * it has the whole story. Unbounded, this would be a memory leak with a
 * debugging feature bolted to it.
 */

/** Entries kept on the tape. Past this the oldest fall off the front. */
export const DEV_LOG_CAPACITY = 1_000;

interface TapeBase {
  /** Monotonic, so the view has a stable key that survives the ring dropping. */
  seq: number;
  atMs: number;
}

export type LangyDevLogRecord =
  | (TapeBase & {
      lane: "stream";
      /** The turn this entry belonged to, or null before one was adopted. */
      turnId: string | null;
      entry: LangyStreamEntry;
    })
  | (TapeBase & {
      lane: "outbound";
      kind: "send" | "stop";
      /** One scannable line for the list row. */
      label: string;
      detail: unknown;
    })
  | (TapeBase & {
      lane: "durable";
      source: "tail";
      event: LangyConversationTurnWireEvent;
    })
  | (TapeBase & {
      lane: "durable";
      source: "snapshot";
      cursor: LangyEventCursor | null;
      currentTurnId: string | null;
    })
  | (TapeBase & {
      lane: "signal";
      conversationId: string;
      cursor: LangyEventCursor | null;
    });

export type LangyDevLogLane = LangyDevLogRecord["lane"];

interface LangyDevLogState {
  /** Nothing is recorded until the drawer arms this. */
  recording: boolean;
  records: LangyDevLogRecord[];
  /** How many entries the ring has discarded, so the view can admit the gap. */
  dropped: number;
  nextSeq: number;
  setRecording: (recording: boolean) => void;
  /** INBOUND stream lane — every live turn-stream entry. */
  record: (entry: LangyStreamEntry, turnId: string | null) => void;
  /** OUTBOUND lane — what this client asked the server to do. */
  recordOutbound: (
    kind: "send" | "stop",
    label: string,
    detail: unknown,
  ) => void;
  /** DURABLE lane — one recorded event off the tail fetch (the event log). */
  recordDurableEvent: (event: LangyConversationTurnWireEvent) => void;
  /** DURABLE lane — a snapshot seed (cursor + in-flight turn), the fold's start. */
  recordSnapshot: (snapshot: {
    cursor: LangyEventCursor | null;
    currentTurnId: string | null;
  }) => void;
  /** SIGNAL lane — a freshness signal and the cursor it carried. */
  recordSignal: (signal: {
    conversationId: string;
    cursor: LangyEventCursor | null;
  }) => void;
  clear: () => void;
}

export const useLangyDevLog = create<LangyDevLogState>((set, get) => {
  const append = (
    make: (seq: number) => LangyDevLogRecord,
  ): void => {
    if (!get().recording) return;
    set((state) => {
      const seq = state.nextSeq;
      const appended = [...state.records, make(seq)];
      const overflow = Math.max(0, appended.length - DEV_LOG_CAPACITY);
      return {
        records: overflow > 0 ? appended.slice(overflow) : appended,
        dropped: state.dropped + overflow,
        nextSeq: seq + 1,
      };
    });
  };
  return {
    recording: false,
    records: [],
    dropped: 0,
    nextSeq: 1,
    setRecording: (recording) => set({ recording }),
    record: (entry, turnId) =>
      append((seq) => ({
        seq,
        atMs: Date.now(),
        lane: "stream",
        turnId,
        entry,
      })),
    recordOutbound: (kind, label, detail) =>
      append((seq) => ({
        seq,
        atMs: Date.now(),
        lane: "outbound",
        kind,
        label,
        detail,
      })),
    recordDurableEvent: (event) =>
      append((seq) => ({
        seq,
        atMs: Date.now(),
        lane: "durable",
        source: "tail",
        event,
      })),
    recordSnapshot: ({ cursor, currentTurnId }) =>
      append((seq) => ({
        seq,
        atMs: Date.now(),
        lane: "durable",
        source: "snapshot",
        cursor,
        currentTurnId,
      })),
    recordSignal: ({ conversationId, cursor }) =>
      append((seq) => ({
        seq,
        atMs: Date.now(),
        lane: "signal",
        conversationId,
        cursor,
      })),
    clear: () => set({ records: [], dropped: 0 }),
  };
});

/** The tape at (or before) one moment — the scrubber's view of history. */
export function tapeUpTo(
  records: LangyDevLogRecord[],
  uptoSeq: number | null,
): LangyDevLogRecord[] {
  if (uptoSeq === null) return records;
  return records.filter((record) => record.seq <= uptoSeq);
}

/**
 * REPLAY the durable lane through the SAME reducers the live store uses
 * (ADR-059): seed from the recorded snapshot, fold the recorded tail. Because
 * the fold is pure and cursor-gated, replaying any prefix of the tape is safe
 * and deterministic — this is what the scrubber shows as "the fold at that
 * moment", recomputed from scratch on every call, never cached state.
 */
export function replayTurnProjection(
  records: LangyDevLogRecord[],
): LangyTurnProjectionState {
  let projection = initialLangyTurnProjection;
  for (const record of records) {
    if (record.lane !== "durable") continue;
    if (record.source === "snapshot") {
      projection = seedLangyTurnProjection(projection, {
        cursor: record.cursor,
        currentTurnId: record.currentTurnId,
      });
    } else {
      projection = applyLangyTurnEvents(projection, [record.event]);
    }
  }
  return projection;
}

/** The stream-lane subset — what the three wire views partition. */
export function streamRecords(
  records: LangyDevLogRecord[],
): Array<Extract<LangyDevLogRecord, { lane: "stream" }>> {
  return records.filter(
    (record): record is Extract<LangyDevLogRecord, { lane: "stream" }> =>
      record.lane === "stream",
  );
}

/**
 * The tape is scoped too, and more sharply than most of the panel: it holds the
 * raw wire — prompt text, tool inputs, tool outputs — for the project it was
 * recorded in. Left alone it survives a project, organization or account change
 * (the store is a module singleton, and only a manual Clear ever emptied it), so
 * one project's traffic stayed readable from inside another.
 *
 * It follows `langyStore`'s scope for the same reason the target registry does,
 * and in the same direction: this module knows about the panel's store, never
 * the other way round.
 */
useLangyStore.subscribe((state, previous) => {
  if (state.activeConversationScope !== previous.activeConversationScope) {
    useLangyDevLog.getState().clear();
  }
});

/**
 * The live answer as the user is receiving it — every `delta` on the tape,
 * concatenated. This is the token stream with the rendering pipeline taken out
 * of the picture, which is exactly what you want when the prose on screen and
 * the prose on the wire disagree.
 */
export function tokenStreamText(records: LangyDevLogRecord[]): string {
  let text = "";
  for (const record of streamRecords(records)) {
    if (record.entry.type === "delta") text += record.entry.text;
  }
  return text;
}

/** How many entries of each kind are on the tape — the shape of a turn at a glance. */
export function entryKindCounts(
  records: LangyDevLogRecord[],
): { kind: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const record of streamRecords(records)) {
    counts.set(record.entry.type, (counts.get(record.entry.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

/** One tool call, folded from its `start` and settle entries on the tape. */
export interface DevToolCall {
  id: string;
  name: string;
  input: unknown;
  /** Undefined while the call is still running. */
  output?: string;
  isError: boolean;
  startedAtMs: number;
  settledAtMs?: number;
  /** Wall time from start to settle, once both halves are on the tape. */
  durationMs?: number;
}

/**
 * Fold the tape's `tool` entries into one row per call.
 *
 * A tool call arrives as TWO entries — `phase: "start"` carrying the input, then
 * a settle carrying the output — so a flat event list shows every call twice and
 * neither half on its own tells you whether it worked or how long it took. This
 * pairs them by id, in first-seen order.
 */
export function toolCallsFrom(records: LangyDevLogRecord[]): DevToolCall[] {
  const byId = new Map<string, DevToolCall>();
  for (const record of streamRecords(records)) {
    const entry = record.entry;
    if (entry.type !== "tool") continue;
    const existing = byId.get(entry.id);
    if (entry.phase === "start") {
      byId.set(entry.id, {
        id: entry.id,
        name: entry.name,
        input: entry.input ?? {},
        isError: false,
        startedAtMs: record.atMs,
      });
      continue;
    }
    // A settle with no start on the tape still deserves a row: the tape may have
    // been armed mid-turn, and a call whose start we missed is not a call that
    // did not happen.
    const base: DevToolCall = existing ?? {
      id: entry.id,
      name: entry.name,
      input: undefined,
      isError: false,
      startedAtMs: record.atMs,
    };
    byId.set(entry.id, {
      ...base,
      ...(entry.output !== undefined ? { output: entry.output } : {}),
      isError: !!entry.isError,
      settledAtMs: record.atMs,
      durationMs: record.atMs - base.startedAtMs,
    });
  }
  return [...byId.values()];
}

/** One scannable line per record, for the unified Log view. */
export function recordSummary(record: LangyDevLogRecord): string {
  switch (record.lane) {
    case "stream": {
      const entry = record.entry;
      if (entry.type === "delta") {
        return entry.text.length > 60
          ? `${entry.text.slice(0, 60)}…`
          : entry.text;
      }
      if (entry.type === "tool") return `${entry.phase ?? ""} ${entry.name}`;
      if (entry.type === "status") return entry.status || "(cleared)";
      if (entry.type === "error") return entry.error;
      return "";
    }
    case "outbound":
      return record.label;
    case "durable":
      return record.source === "snapshot"
        ? `snapshot seed · cursor=${record.cursor ? `${record.cursor.acceptedAt}/${record.cursor.eventId.slice(0, 8)}` : "null"} · turn=${record.currentTurnId ?? "—"}`
        : `${record.event.type.replace("lw.langy_conversation.", "")} · ${record.event.id.slice(0, 8)}`;
    case "signal":
      return `conv=${record.conversationId.slice(-8)} · cursor=${record.cursor ? `${record.cursor.acceptedAt}/${record.cursor.eventId.slice(0, 8)}` : "none"}`;
  }
}

/** The Log row's kind column — lane-specific, one word. */
export function recordKind(record: LangyDevLogRecord): string {
  switch (record.lane) {
    case "stream":
      return record.entry.type;
    case "outbound":
      return record.kind;
    case "durable":
      return record.source === "snapshot" ? "snapshot" : "event";
    case "signal":
      return "signal";
  }
}
