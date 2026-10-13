import { useEffect, useRef } from "react";

import { usePresencePreferencesStore } from "../../../../behavior/presence/presence-preferences-store.ts";
import { useTabSessionId } from "../../../../behavior/presence/use-tab-session-id.ts";
import { api } from "../../../../behavior/trace-api.ts";

const SEND_INTERVAL_MS = 66; // ~15 Hz — imperceptible vs 30 Hz, half the traffic

interface UseCursorBroadcastOptions {
  projectId: string | null | undefined;
  /** Stable anchor identifying the surface (e.g. `trace:abc:panel:flame`). */
  anchor: string | null;
  /** Element whose bounding box defines the (0..1, 0..1) coordinate space. */
  containerRef: React.RefObject<HTMLElement | null>;
  enabled?: boolean;
}

type CursorPoint = { x: number; y: number };

/** The cursor as fractions of the container's box. */
function fractionalPoint({ event, rect }: { event: MouseEvent; rect: DOMRect }): CursorPoint {
  return {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
  };
}

function isInsideUnitBox({ x, y }: CursorPoint): boolean {
  return x >= 0 && x <= 1 && y >= 0 && y <= 1;
}

/**
 * A frame-driven throttle: the latest point waits for the next frame and the
 * send interval, and a point equal to the last one sent is dropped.
 */
function cursorThrottle(send: (point: CursorPoint) => void) {
  let lastSentAt = 0;
  let lastSent: CursorPoint | undefined;
  let pending: CursorPoint | undefined;
  let rafHandle: number | undefined;

  const flush = () => {
    rafHandle = undefined;
    if (!pending) return;
    if (lastSent && lastSent.x === pending.x && lastSent.y === pending.y) {
      pending = undefined;
      return;
    }
    const now = performance.now();
    if (now - lastSentAt < SEND_INTERVAL_MS) {
      rafHandle = requestAnimationFrame(flush);
      return;
    }
    lastSentAt = now;
    lastSent = pending;
    pending = undefined;
    send(lastSent);
  };

  return {
    queue(point: CursorPoint) {
      pending = point;
      rafHandle ??= requestAnimationFrame(flush);
    },
    stop() {
      if (rafHandle !== undefined) cancelAnimationFrame(rafHandle);
    },
  };
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
  // Over the persistent WebSocket: at ~15 Hz, one HTTP request per tick saturated
  // the browser's connection cap.
  const cursorMutation = api.presence.cursor.useMutation({ trpc: { context: { useWS: true } } });
  const sendRef = useRef(cursorMutation.mutateAsync);
  sendRef.current = cursorMutation.mutateAsync;

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || hidden || !container) return;
    if (!projectId || !anchor || !sessionId) return;

    const throttle = cursorThrottle(({ x, y }) => {
      // A tick the server's rate limit drops is fine; the next move reschedules.
      void sendRef
        .current({ projectId, sessionId, payload: { anchor, x, y } })
        .catch(() => undefined);
    });
    const handleMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const point = fractionalPoint({ event, rect });
      if (isInsideUnitBox(point)) throttle.queue(point);
    };

    container.addEventListener("mousemove", handleMove);
    return () => {
      container.removeEventListener("mousemove", handleMove);
      throttle.stop();
    };
  }, [projectId, anchor, sessionId, enabled, hidden, containerRef]);
}
