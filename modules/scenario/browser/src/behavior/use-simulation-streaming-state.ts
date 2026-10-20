import type { CompactStreamingEvent } from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";
import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";

export interface StreamingMessage {
  messageId: string;
  role: string;
  content: string;
  messageIndex?: number;
  status: "streaming" | "complete";
}

/**
 * Broadcast event payload from SSE — compact format only.
 * See `streaming-event-codec.ts` for the wire format.
 */
export type StreamingEventPayload = CompactStreamingEvent;

/**
 * Manages optimistic streaming state from SSE events.
 */
export function useSimulationStreamingState(scenarioRunId?: string) {
  const [store] = useState(createStreamingStore);

  // Cancel RAF and clear buffers on unmount
  useEffect(() => {
    return () => store.destroy();
  }, [store]);

  // Previews belong to one run; drop them before the next run paints.
  useLayoutEffect(() => {
    store.reset();
  }, [store, scenarioRunId]);

  const streamingMessages = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  const handleStreamingEvent = useCallback(
    (payload: StreamingEventPayload) => {
      if (scenarioRunId && payload.r && payload.r !== scenarioRunId) return;
      applyStreamingEvent(store, payload);
    },
    [scenarioRunId, store],
  );

  const reconcileWithServer = useCallback(
    (server: ServerRunSnapshot) => store.reconcile(server),
    [store],
  );

  return { streamingMessages, handleStreamingEvent, reconcileWithServer };
}

function applyStreamingEvent(store: StreamingStore, payload: StreamingEventPayload): void {
  if (payload.e === "R") {
    store.snapshotStored();
    return;
  }
  if (!payload.m) return;

  switch (payload.e) {
    case "S":
      store.upsert(payload.m, {
        messageId: payload.m,
        role: payload.l ?? "assistant",
        content: "",
        messageIndex: payload.i,
        status: "streaming",
      });
      return;
    case "C":
      store.appendDelta(payload.m, payload.d ?? "");
      return;
    case "E":
      store.complete(payload.m, payload.c);
      return;
  }
}

/** One stored message, as far as reconciling a preview needs it. */
export interface ServerMessage {
  id: string;
  /** The stored text as displayed; "" for a START row whose END has not landed. */
  text: string;
}

/** What the stored run says, for reconciling previews against it. */
export interface ServerRunSnapshot {
  serverMessages: ServerMessage[];
  isFinished: boolean;
}

/** A completed preview gives way only once the stored text matches it. */
function isSettledByServer(preview: StreamingMessage, stored: ServerMessage | undefined): boolean {
  if (preview.status !== "complete" || !stored) return false;
  return stored.text === preview.content.trim();
}

// ---------------------------------------------------------------------------
// Mutable store with RAF-batched notifications
// ---------------------------------------------------------------------------

export function createStreamingStore(): StreamingStore {
  return new StreamingStore();
}

export class StreamingStore {
  #messages: StreamingMessage[] = [];
  // Set once the stored run has finished; late events then add nothing.
  #finished = false;
  readonly #notifier = createFrameNotifier<StreamingMessage[]>([]);
  // Buffer for CONTENT deltas that arrive before START
  readonly #earlyDeltas = createEarlyDeltaBuffer();

  // Arrow properties, not methods: useSyncExternalStore holds these
  // references and calls them unbound.
  readonly subscribe = this.#notifier.subscribe;
  readonly getSnapshot = this.#notifier.getSnapshot;

  upsert(messageId: string, msg: StreamingMessage) {
    if (this.#finished) return;
    const buffered = this.#earlyDeltas.take(messageId);
    this.#messages = this.#messages.filter((m) => m.messageId !== messageId);
    this.#messages.push(buffered ? { ...msg, content: msg.content + buffered } : msg);
    this.#publish();
  }

  appendDelta(messageId: string, delta: string) {
    if (this.#finished) return;
    const idx = this.#messages.findIndex((m) => m.messageId === messageId);
    if (idx === -1) {
      this.#earlyDeltas.hold(messageId, delta);
      return;
    }
    const current = this.#messages[idx]!;
    this.#messages[idx] = { ...current, content: current.content + delta };
    this.#publish();
  }

  complete(messageId: string, finalContent?: string) {
    if (this.#finished) return;
    this.#earlyDeltas.drop(messageId);
    if (!this.#messages.some((m) => m.messageId === messageId)) return;
    this.#messages = this.#messages.map((m) =>
      m.messageId === messageId
        ? { ...m, content: finalContent ?? m.content, status: "complete" as const }
        : m,
    );
    this.#publish();
  }

  /**
   * Drops previews the stored run has settled: all of them once the run has
   * finished, else each completed one whose stored text now matches.
   */
  reconcile({ serverMessages, isFinished }: ServerRunSnapshot) {
    const before = this.#messages.length;
    if (isFinished) {
      this.#finished = true;
      this.#earlyDeltas.clear();
    }
    this.#messages = isFinished ? [] : withoutSettled(this.#messages, serverMessages);
    if (this.#messages.length !== before) this.#publish();
  }

  /**
   * A message snapshot was stored: it is the run's truth, so every preview
   * goes. The SDK sends one only with no message open; a finished run stays
   * finished.
   */
  snapshotStored() {
    this.#earlyDeltas.clear();
    if (this.#messages.length === 0) return;
    this.#messages = [];
    this.#publish();
  }

  /** Forgets every preview at once, for a switch to another run. */
  reset() {
    this.#finished = false;
    this.#earlyDeltas.clear();
    if (this.#messages.length === 0 && this.#notifier.getSnapshot().length === 0) return;
    this.#messages = [];
    this.#notifier.now([]);
  }

  destroy() {
    this.#notifier.cancel();
    this.#earlyDeltas.clear();
    this.#messages = [];
    this.#notifier.replace([]);
  }

  #publish() {
    this.#notifier.schedule(() => [...this.#messages]);
  }
}

function withoutSettled(
  previews: StreamingMessage[],
  serverMessages: ServerMessage[],
): StreamingMessage[] {
  const byId = new Map(serverMessages.map((m) => [m.id, m]));
  return previews.filter((m) => !isSettledByServer(m, byId.get(m.messageId)));
}

/** Publishes a snapshot to subscribers at most once per animation frame. */
function createFrameNotifier<T>(initial: T) {
  let snapshot = initial;
  let rafId: number | null = null;
  const listeners = new Set<() => void>();

  const cancel = () => {
    if (rafId == null) return;
    cancelAnimationFrame(rafId);
    rafId = null;
  };

  const now = (next: T) => {
    cancel();
    snapshot = next; // new reference so useSyncExternalStore triggers render
    for (const listener of listeners) listener();
  };

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    schedule(next: () => T) {
      if (rafId != null) return; // already scheduled
      rafId = requestAnimationFrame(() => {
        rafId = null;
        now(next());
      });
    },
    now,
    cancel,
    replace(next: T) {
      snapshot = next;
    },
  };
}

const EARLY_DELTA_TTL_MS = 10_000;
const EARLY_DELTA_SWEEP_MS = 5_000;

/**
 * CONTENT deltas held until their START arrives. Its sweep timer, which drops
 * deltas whose START never came, runs only while some are held.
 */
function createEarlyDeltaBuffer() {
  const held = new Map<string, { deltas: string[]; receivedAt: number }>();
  let sweepTimer: ReturnType<typeof setInterval> | null = null;

  const stopSweepWhenEmpty = () => {
    if (held.size > 0 || sweepTimer == null) return;
    clearInterval(sweepTimer);
    sweepTimer = null;
  };

  const sweep = () => {
    const now = nowInstant().epochMilliseconds;
    for (const [id, entry] of held) {
      if (now - entry.receivedAt > EARLY_DELTA_TTL_MS) held.delete(id);
    }
    stopSweepWhenEmpty();
  };

  return {
    hold(messageId: string, delta: string) {
      const entry = held.get(messageId) ?? {
        deltas: [],
        receivedAt: nowInstant().epochMilliseconds,
      };
      entry.deltas.push(delta);
      held.set(messageId, entry);
      sweepTimer ??= setInterval(sweep, EARLY_DELTA_SWEEP_MS);
    },
    /** The held text for a message, removed from the buffer; undefined if none. */
    take(messageId: string): string | undefined {
      const entry = held.get(messageId);
      held.delete(messageId);
      stopSweepWhenEmpty();
      return entry?.deltas.length ? entry.deltas.join("") : void 0;
    },
    drop(messageId: string) {
      held.delete(messageId);
      stopSweepWhenEmpty();
    },
    clear() {
      held.clear();
      stopSweepWhenEmpty();
    },
  };
}
