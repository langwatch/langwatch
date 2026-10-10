import type { CompactStreamingEvent } from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

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

  const streamingMessages = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  const handleStreamingEvent = useCallback(
    (payload: StreamingEventPayload) => {
      if (scenarioRunId && payload.r && payload.r !== scenarioRunId) return;
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
    },
    [scenarioRunId, store],
  );

  const clearCompleted = useCallback(
    (serverMessageIds: string[]) => {
      store.clearByIds(serverMessageIds);
    },
    [store],
  );

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
  const earlyDeltas = new Map<string, EarlyDelta>();

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
    clearStaleEarlyDeltas(earlyDeltas);
  }, 5_000);

  return {
    // Arrow properties, not methods: useSyncExternalStore holds these
    // references and calls them unbound, which is unsafe against a
    // method-shorthand member even though neither reads `this`.
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot: () => {
      return snapshot;
    },

    upsert(messageId: string, msg: StreamingMessage) {
      messages = messages.filter((m) => m.messageId !== messageId);
      // Apply any buffered early deltas
      messages.push(applyEarlyDeltas(earlyDeltas, messageId, msg));
      scheduleNotify();
    },

    appendDelta(messageId: string, delta: string) {
      const idx = messages.findIndex((m) => m.messageId === messageId);
      if (idx === -1) {
        // Buffer early deltas until START arrives
        const entry = earlyDeltas.get(messageId) ?? {
          deltas: [],
          receivedAt: nowInstant().epochMilliseconds,
        };
        entry.deltas.push(delta);
        earlyDeltas.set(messageId, entry);
        return;
      }
      messages[idx] = {
        ...messages[idx]!,
        content: messages[idx]!.content + delta,
      };
      scheduleNotify();
    },

    complete(messageId: string, finalContent?: string) {
      messages = messages.map((m) =>
        m.messageId === messageId
          ? {
              ...m,
              content: finalContent ?? m.content,
              status: "complete" as const,
            }
          : m,
      );
      earlyDeltas.delete(messageId);
      scheduleNotify();
    },

    clearByIds(serverIds: string[]) {
      const idSet = new Set(serverIds);
      const before = messages.length;
      messages = messages.filter((m) => !(idSet.has(m.messageId) && m.status === "complete"));
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

type EarlyDelta = { deltas: string[]; receivedAt: number };
const EARLY_DELTA_TTL_MS = 10_000;

function clearStaleEarlyDeltas(earlyDeltas: Map<string, EarlyDelta>): void {
  const now = nowInstant().epochMilliseconds;
  for (const [id, entry] of earlyDeltas) {
    if (now - entry.receivedAt > EARLY_DELTA_TTL_MS) {
      earlyDeltas.delete(id);
    }
  }
}

function applyEarlyDeltas(
  earlyDeltas: Map<string, EarlyDelta>,
  messageId: string,
  message: StreamingMessage,
): StreamingMessage {
  const buffered = earlyDeltas.get(messageId);
  if (!buffered?.deltas.length) {
    return message;
  }
  earlyDeltas.delete(messageId);
  return { ...message, content: message.content + buffered.deltas.join("") };
}
