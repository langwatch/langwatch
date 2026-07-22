import { create } from "zustand";
import type { LangyStreamEntry } from "~/server/app-layer/langy/streaming/langyTokenBuffer";
import { useLangyStore } from "./langyStore";

/**
 * The developer drawer's record of what actually came down the wire.
 *
 * Langy's UI is several layers of interpretation stacked on one stream: the
 * transport maps entries to AI-SDK chunks, the chunks become message parts, the
 * parts become cards, and signals fork off into the store to drive status lines
 * and fold motion. When something renders wrong, the question is always the same
 * one — "what did the server actually send?" — and until now the honest answer
 * required a breakpoint.
 *
 * So this is the raw tape: every `LangyStreamEntry`, in arrival order, with the
 * turn it belonged to and when it landed. No interpretation, no filtering.
 *
 * ── COSTS NOTHING WHEN OFF ─────────────────────────────────────────────────
 * `record()` returns immediately unless recording is armed, and arming is done
 * by the drawer itself (developer mode). A user who never opens it pays one
 * boolean check per wire entry — on a stream that is already doing a React
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

export interface LangyDevLogRecord {
  /** Monotonic, so the view has a stable key that survives the ring dropping. */
  seq: number;
  atMs: number;
  /** The turn this entry belonged to, or null before one was adopted. */
  turnId: string | null;
  entry: LangyStreamEntry;
}

interface LangyDevLogState {
  /** Nothing is recorded until the drawer arms this. */
  recording: boolean;
  records: LangyDevLogRecord[];
  /** How many entries the ring has discarded, so the view can admit the gap. */
  dropped: number;
  nextSeq: number;
  setRecording: (recording: boolean) => void;
  record: (entry: LangyStreamEntry, turnId: string | null) => void;
  clear: () => void;
}

export const useLangyDevLog = create<LangyDevLogState>((set, get) => ({
  recording: false,
  records: [],
  dropped: 0,
  nextSeq: 1,
  setRecording: (recording) => set({ recording }),
  record: (entry, turnId) => {
    if (!get().recording) return;
    set((state) => {
      const seq = state.nextSeq;
      const appended = [
        ...state.records,
        { seq, atMs: Date.now(), turnId, entry },
      ];
      const overflow = Math.max(0, appended.length - DEV_LOG_CAPACITY);
      return {
        records: overflow > 0 ? appended.slice(overflow) : appended,
        dropped: state.dropped + overflow,
        nextSeq: seq + 1,
      };
    });
  },
  clear: () => set({ records: [], dropped: 0 }),
}));

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
  for (const record of records) {
    if (record.entry.type === "delta") text += record.entry.text;
  }
  return text;
}

/** How many entries of each kind are on the tape — the shape of a turn at a glance. */
export function entryKindCounts(
  records: LangyDevLogRecord[],
): { kind: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const record of records) {
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
  for (const record of records) {
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
