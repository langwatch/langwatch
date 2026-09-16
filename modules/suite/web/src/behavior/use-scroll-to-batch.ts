/**
 * Scrolls to and highlights a batch row in run history: when
 * `highlightBatchId` is set, waits for `[data-batch-id]` to appear, scrolls
 * it into view unless it's the first row, then flashes yellow for ~2s.
 */
import { useEffect, useState } from "react";

const HIGHLIGHT_DURATION_MS = 2000;
const POLL_INTERVAL_MS = 100;
const MAX_POLL_ATTEMPTS = 50; // 5 seconds max

export function useScrollToBatch({
  highlightBatchId,
}: {
  highlightBatchId: string | null | undefined;
}): { highlightedBatchId: string | null } {
  const [highlightedBatchId, setHighlightedBatchId] = useState<string | null>(null);

  useEffect(() => {
    if (!highlightBatchId) {
      setHighlightedBatchId(null);
      return;
    }

    let attempts = 0;
    let cancelled = false;
    let highlightTimer: ReturnType<typeof setTimeout> | null = null;

    const poll = () => {
      if (cancelled) return;

      const el = document.querySelector(`[data-batch-id="${highlightBatchId}"]`);
      if (!el) {
        attempts++;
        if (attempts < MAX_POLL_ATTEMPTS) {
          requestAnimationFrame(poll);
        }
        return;
      }

      // Check if it's the first batch row
      const allRows = document.querySelectorAll("[data-batch-id]");
      const isFirst = allRows[0] === el;

      if (!isFirst) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }

      // Trigger highlight
      setHighlightedBatchId(highlightBatchId);

      // Clear after duration
      highlightTimer = setTimeout(() => {
        if (!cancelled) {
          setHighlightedBatchId(null);
        }
      }, HIGHLIGHT_DURATION_MS);
    };

    // Start polling after a short delay to let the initial render settle
    const timer = setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (highlightTimer) clearTimeout(highlightTimer);
    };
  }, [highlightBatchId]);

  return { highlightedBatchId };
}
