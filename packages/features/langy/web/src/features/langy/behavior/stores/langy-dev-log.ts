import {
  applyLangyTurnEvents,
  initialLangyTurnProjection,
  type LangyConversationTurnWireEvent,
  type LangyEventCursor,
  type LangyTurnProjectionState,
  seedLangyTurnProjection,
} from "@langwatch/langy-contract";
import { create } from "zustand";
import type { LangyStreamEntry } from "@langwatch/langy-contract";
import { useLangyStore } from "../../../../index";

/**
 * The developer drawer's record of what actually crossed the wire — in BOTH directions,
 * on every channel.
 */

/** Entries kept on the tape. Past this the oldest fall off the front. */
export const DEV_LOG_CAPACITY = 1_000;

interface TapeBase {
  /** Monotonic, so the view has a stable key that survives the ring dropping. */
  seq: number;
  atMs: number;
  /**
   * The conversation this entry belongs to, stamped AT RECORD TIME.
   */
  conversationId: string | null;
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
  /**
   * The scrubber's position — the tape seq every view (INCLUDING the chat
   * panel, which time-travels with it) is capped at. Null is LIVE. Lives here
   * rather than in the drawer so the panel can read it without prop plumbing.
   */
  scrubSeq: number | null;
  setScrub: (seq: number | null) => void;
  setRecording: (recording: boolean) => void;
  /** INBOUND stream lane — every live turn-stream entry. */
  record: (entry: LangyStreamEntry, turnId: string | null) => void;
  /** OUTBOUND lane — what this client asked the server to do. */
  recordOutbound: (kind: "send" | "stop", label: string, detail: unknown) => void;
  /** DURABLE lane — one recorded event off the tail fetch (the event log). */
  recordDurableEvent: (event: LangyConversationTurnWireEvent) => void;
  /** DURABLE lane — a snapshot seed (cursor + in-flight turn), the fold's start. */
  recordSnapshot: (snapshot: {
    conversationId: string;
    cursor: LangyEventCursor | null;
    currentTurnId: string | null;
  }) => void;
  /** SIGNAL lane — a freshness signal and the cursor it carried. */
  recordSignal: (signal: { conversationId: string; cursor: LangyEventCursor | null }) => void;
  clear: () => void;
}

export const useLangyDevLog = create<LangyDevLogState>((set, get) => {
  const append = (make: (seq: number) => LangyDevLogRecord): void => {
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
  /**
   * The conversation an entry belongs to, resolved AT RECORD TIME: the entry's own
   * attribution when it has one, otherwise the store's active conversation.
   */
  const attributed = (explicit?: string | null): string | null =>
    explicit ?? useLangyStore.getState().activeConversationId;
  return {
    recording: false,
    records: [],
    dropped: 0,
    nextSeq: 1,
    scrubSeq: null,
    setScrub: (scrubSeq) => set({ scrubSeq }),
    // Disarming also snaps back to live: a closed drawer must never leave the
    // panel frozen in the past.
    setRecording: (recording) => set(recording ? { recording } : { recording, scrubSeq: null }),
    record: (entry, turnId) =>
      append((seq) => ({
        seq,
        atMs: Date.now(),
        conversationId: attributed(),
        lane: "stream",
        turnId,
        entry,
      })),
    recordOutbound: (kind, label, detail) =>
      append((seq) => ({
        seq,
        atMs: Date.now(),
        // The send/stop callers put the conversation in the detail payload;
        // read it from there so the tag survives even when the store has not
        // adopted the conversation yet (a stop raced against a fresh send).
        conversationId: attributed(
          typeof (detail as { conversationId?: unknown } | null)?.conversationId === "string"
            ? (detail as { conversationId: string }).conversationId
            : undefined,
        ),
        lane: "outbound",
        kind,
        label,
        detail,
      })),
    recordDurableEvent: (event) =>
      append((seq) => ({
        seq,
        atMs: Date.now(),
        // Every wire event names its conversation — the fold's identity.
        conversationId: attributed(event.data.conversationId),
        lane: "durable",
        source: "tail",
        event,
      })),
    recordSnapshot: ({ conversationId, cursor, currentTurnId }) =>
      append((seq) => ({
        seq,
        atMs: Date.now(),
        conversationId,
        lane: "durable",
        source: "snapshot",
        cursor,
        currentTurnId,
      })),
    recordSignal: ({ conversationId, cursor }) =>
      append((seq) => ({
        seq,
        atMs: Date.now(),
        conversationId,
        lane: "signal",
        cursor,
      })),
    clear: () => set({ records: [], dropped: 0 }),
  };
});

/**
 * The tape, scoped to one conversation — what the drawer's views and the chat panel's
 * time travel render.
 */
export function tapeForConversation(
  records: LangyDevLogRecord[],
  conversationId: string | null,
): LangyDevLogRecord[] {
  return records.filter(
    (record) => record.conversationId === null || record.conversationId === conversationId,
  );
}

/** The tape at (or before) one moment — the scrubber's view of history. */
export function tapeUpTo(
  records: LangyDevLogRecord[],
  uptoSeq: number | null,
): LangyDevLogRecord[] {
  if (uptoSeq === null) return records;
  return records.filter((record) => record.seq <= uptoSeq);
}

/**
 * REPLAY the durable lane through the SAME reducers the live store uses (ADR-059): seed
 * from the recorded snapshot, fold the recorded tail.
 */
export function replayTurnProjection(records: LangyDevLogRecord[]): LangyTurnProjectionState {
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
    (record): record is Extract<LangyDevLogRecord, { lane: "stream" }> => record.lane === "stream",
  );
}

/**
 * The tape is scoped too, and more sharply than most of the panel: it holds the raw
 * wire — prompt text, tool inputs, tool outputs — for the project it was recorded in.
 */
useLangyStore.subscribe((state, previous) => {
  if (state.activeConversationScope !== previous.activeConversationScope) {
    useLangyDevLog.getState().clear();
  }
});

/**
 * The live answer as the user is receiving it — every `delta` on the tape,
 * concatenated.
 */
export function tokenStreamText(records: LangyDevLogRecord[]): string {
  let text = "";
  for (const record of streamRecords(records)) {
    if (record.entry.type === "delta") text += record.entry.text;
  }
  return text;
}

/** How many entries of each kind are on the tape — the shape of a turn at a glance. */
export function entryKindCounts(records: LangyDevLogRecord[]): { kind: string; count: number }[] {
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
        return entry.text.length > 60 ? `${entry.text.slice(0, 60)}…` : entry.text;
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
