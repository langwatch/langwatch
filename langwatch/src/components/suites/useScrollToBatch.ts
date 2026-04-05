/**
 * Scrolls to and highlights a specific batch row in the run history.
 *
 * When `highlightBatchId` is set:
 * 1. Waits for a `[data-batch-id="..."]` element to appear in the DOM
 * 2. If it's NOT the first row, scrolls it into view
 * 3. Triggers a yellow flash highlight that fades after ~2 seconds
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
      setTimeout(() => {
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
    };
  }, [highlightBatchId]);

  return { highlightedBatchId };
}
