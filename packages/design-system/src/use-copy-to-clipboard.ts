import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Single shared duration for the "copied ✓" confirmation across every copy
 * button in traces-v2. Each site previously hard-coded its own value
 * (1200/1500/2000ms), flickering differently per button. Consolidated.
 */
export const COPY_FEEDBACK_MS = 1500;

/**
 * Copy text to clipboard and flash `copied: true` for {@link COPY_FEEDBACK_MS}.
 * Rapid repeats coalesce onto one timer; cleared on unmount.
 */
export function useCopyToClipboard(): {
  copied: boolean;
  copy: (text: string) => void;
} {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  const copy = useCallback(
    (text: string) => {
      void navigator.clipboard
        .writeText(text)
        .then(() => {
          // The write can resolve after the component unmounts; don't touch
          // state then (avoids a React set-state-on-unmounted no-op warning).
          if (!mountedRef.current) return;
          setCopied(true);
          clearTimer();
          timerRef.current = setTimeout(() => {
            setCopied(false);
            timerRef.current = null;
          }, COPY_FEEDBACK_MS);
        })
        .catch(() => {
          // Stay silent on rejection — the surface is a small icon button
          // with no room for an error string, and the user can retry.
        });
    },
    [clearTimer],
  );

  return { copied, copy };
}
