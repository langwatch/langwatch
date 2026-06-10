import { useEffect, useMemo, useRef, useState } from "react";
import { useSSESubscription } from "~/hooks/useSSESubscription";
import type { PresenceCursorEvent } from "~/server/app-layer/presence/types";
import { api } from "~/utils/api";
import { useTabSessionId } from "./useTabSessionId";

const STALE_AFTER_MS = 3_000;
const SWEEP_INTERVAL_MS = 750;

export interface PeerCursor extends PresenceCursorEvent {
  /** Local clock at which we last received this peer's tick. */
  receivedAt: number;
}

interface UsePeerCursorsOptions {
  projectId: string | null | undefined;
  anchor: string | null;
  enabled?: boolean;
}

/**
 * Subscribes to the cursor channel for a single anchor and returns the
 * currently-live peer cursors keyed by sessionId. Cursors are evicted
 * after {@link STALE_AFTER_MS} of silence so a peer who navigates away
 * stops rendering even if the unmount-leave didn't make it through.
 */
export function usePeerCursors({
  projectId,
  anchor,
  enabled = true,
}: UsePeerCursorsOptions): PeerCursor[] {
  const sessionId = useTabSessionId();
  const [cursors, setCursors] = useState<Map<string, PeerCursor>>(
    () => new Map(),
  );
  const cursorsRef = useRef(cursors);
  cursorsRef.current = cursors;

  const subscriptionEnabled = Boolean(
    enabled && projectId && anchor && sessionId,
  );

  useSSESubscription<PresenceCursorEvent, {
    projectId: string;
    anchor: string;
    sessionId: string;
  }>(
    // @ts-expect-error - tRPC subscription type mismatch with hook signature
    api.presence.onPresenceCursor,
    {
      projectId: projectId ?? "",
      anchor: anchor ?? "",
      sessionId,
    },
    {
      enabled: subscriptionEnabled,
      onData: (event) => {
        setCursors((prev) => {
          const next = new Map(prev);
          next.set(event.sessionId, { ...event, receivedAt: Date.now() });
          return next;
        });
      },
      onStopped: () => setCursors(new Map()),
      onError: () => setCursors(new Map()),
    },
  );

  // Reset whenever the anchor changes — old cursors no longer apply.
  useEffect(() => {
    setCursors(new Map());
  }, [anchor, projectId]);

  // Sweep stale cursors so peers who navigated away stop rendering.
  useEffect(() => {
    if (!subscriptionEnabled) return;
    const timer = setInterval(() => {
      const now = Date.now();
      const current = cursorsRef.current;
      let mutated = false;
      const next = new Map(current);
      for (const [id, cursor] of current) {
        if (now - cursor.receivedAt > STALE_AFTER_MS) {
          next.delete(id);
          mutated = true;
        }
      }
      if (mutated) setCursors(next);
    }, SWEEP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [subscriptionEnabled]);

  // The Map identity is replaced inside applyEvent on every change; deriving
  // the array via useMemo on that identity keeps the consumer's prop stable
  // across parent re-renders and lets PeerCursorOverlay short-circuit.
  return useMemo(() => Array.from(cursors.values()), [cursors]);
}
