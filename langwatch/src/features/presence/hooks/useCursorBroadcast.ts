import { useEffect, useRef } from "react";
import { api } from "~/utils/api";
import { usePresencePreferencesStore } from "../stores/presencePreferencesStore";
import { useTabSessionId } from "./useTabSessionId";

const SEND_INTERVAL_MS = 66; // ~15 Hz — imperceptible vs 30 Hz, half the traffic

interface UseCursorBroadcastOptions {
  projectId: string | null | undefined;
  /** Stable anchor identifying the surface (e.g. `trace:abc:panel:flame`). */
  anchor: string | null;
  /** Element whose bounding box defines the (0..1, 0..1) coordinate space. */
  containerRef: React.RefObject<HTMLElement | null>;
  enabled?: boolean;
}

/**
 * Tracks the local user's cursor inside `containerRef` and forwards a
 * throttled stream of fractional coordinates over the presence cursor
 * channel. Only emits while the cursor is *inside* the container.
 */
export function useCursorBroadcast({
  projectId,
  anchor,
  containerRef,
  enabled = true,
}: UseCursorBroadcastOptions): void {
  const sessionId = useTabSessionId();
  const hidden = usePresencePreferencesStore((s) => s.hidden);
  // Route this mutation over the persistent tRPC WebSocket — at ~15 Hz one
  // HTTP request per tick was saturating the browser's connection cap.
  const cursorMutation = api.presence.cursor.useMutation({
    trpc: { context: { useWS: true } },
  });
  const sendRef = useRef(cursorMutation.mutateAsync);
  sendRef.current = cursorMutation.mutateAsync;

  useEffect(() => {
    if (!enabled || hidden || !projectId || !anchor || !sessionId) return;
    const container = containerRef.current;
    if (!container) return;

    let lastSentAt = 0;
    let lastSent: { x: number; y: number } | null = null;
    let pending: { x: number; y: number } | null = null;
    let rafHandle: number | null = null;

    const flush = () => {
      rafHandle = null;
      if (!pending) return;
      if (
        lastSent &&
        lastSent.x === pending.x &&
        lastSent.y === pending.y
      ) {
        pending = null;
        return;
      }
      const now = performance.now();
      if (now - lastSentAt < SEND_INTERVAL_MS) {
        rafHandle = requestAnimationFrame(flush);
        return;
      }
      lastSentAt = now;
      const { x, y } = pending;
      lastSent = pending;
      pending = null;
      void sendRef
        .current({
          projectId,
          sessionId,
          payload: { anchor, x, y },
        })
        .catch(() => {
          // Server-side rate limit dropped this tick — fine, the next move
          // event will reschedule.
        });
    };

    const handleMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      pending = { x, y };
      if (rafHandle == null) rafHandle = requestAnimationFrame(flush);
    };

    container.addEventListener("mousemove", handleMove);
    return () => {
      container.removeEventListener("mousemove", handleMove);
      if (rafHandle != null) cancelAnimationFrame(rafHandle);
    };
  }, [projectId, anchor, sessionId, enabled, hidden, containerRef]);
}
