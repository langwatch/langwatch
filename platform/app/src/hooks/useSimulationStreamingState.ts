import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
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
  const storeRef = useRef(createStreamingStore());

  // Cancel RAF and clear buffers on unmount
  useEffect(() => {
    return () => storeRef.current.destroy();
  }, []);

  const streamingMessages = useSyncExternalStore(
    storeRef.current.subscribe,
    storeRef.current.getSnapshot,
    storeRef.current.getSnapshot,
  );

  const handleStreamingEvent = useCallback(
    (payload: StreamingEventPayload) => {
      if (scenarioRunId && payload.r && payload.r !== scenarioRunId) return;
      if (!payload.m) return;

      const store = storeRef.current;

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
    },
    [scenarioRunId],
  );

  const clearCompleted = useCallback((serverMessageIds: string[]) => {
    storeRef.current.clearByIds(serverMessageIds);
  }, []);

  return { streamingMessages, handleStreamingEvent, clearCompleted };
}

// ---------------------------------------------------------------------------
// Mutable store with RAF-batched notifications
// ---------------------------------------------------------------------------

export function createStreamingStore() {
  let messages: StreamingMessage[] = [];
  let snapshot: StreamingMessage[] = messages;
  const listeners = new Set<() => void>();
  let rafId: number | null = null;

  // Buffer for CONTENT deltas that arrive before START
  const earlyDeltas = new Map<string, { deltas: string[]; receivedAt: number }>();
  const EARLY_DELTA_TTL_MS = 10_000;

  function scheduleNotify() {
    if (rafId != null) return; // already scheduled
    rafId = requestAnimationFrame(() => {
      rafId = null;
      snapshot = [...messages]; // new reference so useSyncExternalStore triggers render
      for (const l of listeners) l();
    });
  }

  // Periodic cleanup of stale early deltas (in case START never arrives)
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of earlyDeltas) {
      if (now - entry.receivedAt > EARLY_DELTA_TTL_MS) {
        earlyDeltas.delete(id);
      }
    }
  }, 5_000);

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot() {
      return snapshot;
    },

    upsert(messageId: string, msg: StreamingMessage) {
      messages = messages.filter((m) => m.messageId !== messageId);
      // Apply any buffered early deltas
      const buffered = earlyDeltas.get(messageId);
      if (buffered?.deltas.length) {
        msg = { ...msg, content: msg.content + buffered.deltas.join("") };
        earlyDeltas.delete(messageId);
      }
      messages.push(msg);
      scheduleNotify();
    },

    appendDelta(messageId: string, delta: string) {
      const idx = messages.findIndex((m) => m.messageId === messageId);
      if (idx === -1) {
        // Buffer early deltas until START arrives
        const entry = earlyDeltas.get(messageId) ?? {
          deltas: [],
          receivedAt: Date.now(),
        };
        entry.deltas.push(delta);
        earlyDeltas.set(messageId, entry);
        return;
      }
      messages[idx] = { ...messages[idx]!, content: messages[idx]!.content + delta };
      scheduleNotify();
    },

    complete(messageId: string, finalContent?: string) {
      messages = messages.map((m) =>
        m.messageId === messageId
          ? { ...m, content: finalContent ?? m.content, status: "complete" as const }
          : m,
      );
      earlyDeltas.delete(messageId);
      scheduleNotify();
    },

    clearByIds(serverIds: string[]) {
      const idSet = new Set(serverIds);
      const before = messages.length;
      messages = messages.filter(
        (m) => !(idSet.has(m.messageId) && m.status === "complete"),
      );
      if (messages.length !== before) {
        scheduleNotify();
      }
    },

    destroy() {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      clearInterval(cleanupTimer);
      earlyDeltas.clear();
      messages = [];
      snapshot = [];
    },
  };
}
