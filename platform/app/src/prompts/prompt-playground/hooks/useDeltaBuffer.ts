import { useCallback, useEffect, useRef } from "react";

/**
 * Batches streaming deltas into one state write per animation frame.
 *
 * A token-by-token stream produces a state update per token, and the previous
 * arrangement also persisted the whole conversation to localStorage on each
 * one. Coalescing on a frame keeps the reply visibly live while leaving the
 * render count bounded by the display rather than by the model's throughput.
 */
export interface DeltaBuffer {
  /** Starts a new run against a message id, discarding anything pending. */
  begin: (id: string) => void;
  /** Records the full text so far; the flush uses the latest value seen. */
  set: (content: string) => void;
  /** Drops any pending frame — the run has settled and will write directly. */
  cancel: () => void;
}

export function useDeltaBuffer(
  apply: (update: { id: string; content: string }) => void,
): DeltaBuffer {
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<{ id: string; content: string } | null>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const cancel = useCallback(() => {
    if (frameRef.current === null) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const begin = useCallback(
    (id: string) => {
      // The previous run's frame is dropped, not left scheduled. Leaving it
      // meant the new run's first `set` returned early — the frame was still
      // outstanding — so the opening tokens waited for a frame belonging to a
      // reply that had already ended.
      cancel();
      pendingRef.current = { id, content: "" };
    },
    [cancel],
  );

  const set = useCallback((content: string) => {
    const pending = pendingRef.current;
    if (!pending) return;
    pending.content = content;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (pendingRef.current) applyRef.current({ ...pendingRef.current });
    });
  }, []);

  return { begin, set, cancel };
}
