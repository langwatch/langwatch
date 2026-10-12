import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import type { CompactStreamingEvent } from "~/utils/streaming-event-codec";

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
 *
 * Uses a mutable store + useSyncExternalStore so rapid CONTENT deltas
 * are batched into a single render per animation frame instead of
 * triggering a React re-render on every token.
 */
export function useSimulationStreamingState(scenarioRunId?: string) {
  const storeRef = useRef<StreamingStore | null>(null);
  storeRef.current ??= createStreamingStore();
  const store = storeRef.current;

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
      applyStreamingEvent({ store, payload });
    },
    [store, scenarioRunId],
  );

  const reconcileWithServer = useCallback(
    (server: ServerRunSnapshot) => store.reconcile(server),
    [store],
  );

  return { streamingMessages, handleStreamingEvent, reconcileWithServer };
}

function applyStreamingEvent({
  store,
  payload,
}: {
  store: StreamingStore;
  payload: StreamingEventPayload;
}) {
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
function isSettledByServer({
  preview,
  stored,
}: {
  preview: StreamingMessage;
  stored: ServerMessage | undefined;
}): boolean {
  if (preview.status !== "complete" || !stored) return false;
  return stored.text === preview.content.trim();
}

export type StreamingStore = ReturnType<typeof createStreamingStore>;

// ---------------------------------------------------------------------------
// Mutable store with RAF-batched notifications
// ---------------------------------------------------------------------------

export function createStreamingStore() {
  let messages: StreamingMessage[] = [];
  let snapshot: StreamingMessage[] = messages;
  const listeners = new Set<() => void>();
  let rafId: number | null = null;
  // Set once the stored run has finished; late events then add nothing.
  let finished = false;

  // Buffer for CONTENT deltas that arrive before START
  const earlyDeltas = new Map<
    string,
    { deltas: string[]; receivedAt: number }
  >();
  const EARLY_DELTA_TTL_MS = 10_000;

  function notifyNow() {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    snapshot = [...messages];
    for (const l of listeners) l();
  }

  function scheduleNotify() {
    if (rafId != null) return; // already scheduled
    rafId = requestAnimationFrame(() => {
      rafId = null;
      snapshot = [...messages]; // new reference so useSyncExternalStore triggers render
      for (const l of listeners) l();
    });
  }

  // Periodic cleanup of stale early deltas (in case START never arrives),
  // running only while some are held.
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  function stopCleanup() {
    if (cleanupTimer == null) return;
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  function dropEarlyDeltas(messageId?: string) {
    if (messageId == null) earlyDeltas.clear();
    else earlyDeltas.delete(messageId);
    if (earlyDeltas.size === 0) stopCleanup();
  }

  function startCleanup() {
    if (cleanupTimer != null) return;
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, entry] of earlyDeltas) {
        if (now - entry.receivedAt > EARLY_DELTA_TTL_MS) {
          earlyDeltas.delete(id);
        }
      }
      if (earlyDeltas.size === 0) stopCleanup();
    }, 5_000);
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot() {
      return snapshot;
    },

    upsert(messageId: string, msg: StreamingMessage) {
      if (finished) return;
      messages = messages.filter((m) => m.messageId !== messageId);
      // Apply any buffered early deltas
      const buffered = earlyDeltas.get(messageId);
      if (buffered?.deltas.length) {
        msg = { ...msg, content: msg.content + buffered.deltas.join("") };
        dropEarlyDeltas(messageId);
      }
      messages.push(msg);
      scheduleNotify();
    },

    appendDelta(messageId: string, delta: string) {
      if (finished) return;
      const idx = messages.findIndex((m) => m.messageId === messageId);
      if (idx === -1) {
        // Buffer early deltas until START arrives
        const entry = earlyDeltas.get(messageId) ?? {
          deltas: [],
          receivedAt: Date.now(),
        };
        entry.deltas.push(delta);
        earlyDeltas.set(messageId, entry);
        startCleanup();
        return;
      }
      messages[idx] = {
        ...messages[idx]!,
        content: messages[idx]!.content + delta,
      };
      scheduleNotify();
    },

    complete(messageId: string, finalContent?: string) {
      if (finished) return;
      dropEarlyDeltas(messageId);
      if (!messages.some((m) => m.messageId === messageId)) return;
      messages = messages.map((m) =>
        m.messageId === messageId
          ? {
              ...m,
              content: finalContent ?? m.content,
              status: "complete" as const,
            }
          : m,
      );
      scheduleNotify();
    },

    /**
     * Drops previews the stored run has settled: all of them once the run has
     * finished, else each completed one whose stored text now matches.
     */
    reconcile({ serverMessages, isFinished }: ServerRunSnapshot) {
      const before = messages.length;
      if (isFinished) {
        finished = true;
        messages = [];
        dropEarlyDeltas();
      } else {
        const byId = new Map(serverMessages.map((m) => [m.id, m]));
        messages = messages.filter(
          (m) =>
            !isSettledByServer({ preview: m, stored: byId.get(m.messageId) }),
        );
      }
      if (messages.length !== before) {
        scheduleNotify();
      }
    },

    /**
     * A message snapshot was stored: it is the run's truth, so every preview
     * goes. The SDK sends one only with no message open; a finished run stays
     * finished.
     */
    snapshotStored() {
      dropEarlyDeltas();
      if (messages.length === 0) return;
      messages = [];
      scheduleNotify();
    },

    /** Forgets every preview at once, for a switch to another run. */
    reset() {
      finished = false;
      dropEarlyDeltas();
      if (messages.length === 0 && snapshot.length === 0) return;
      messages = [];
      notifyNow();
    },

    destroy() {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      stopCleanup();
      earlyDeltas.clear();
      messages = [];
      snapshot = [];
    },
  };
}
