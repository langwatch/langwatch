import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Single shared duration for the transient "copied ✓" confirmation across
 * every copy button in traces-v2. Previously each site hard-coded its own
 * value (1200 / 1500 / 2000ms), so the feedback flickered for a different
 * length depending on which button you clicked. Consolidated to 1500ms.
 */
export const COPY_FEEDBACK_MS = 1500;

/**
 * The "copy to clipboard, then flash a ✓ for a beat" pattern, extracted from
 * the ~9 hand-rolled `useState(false)` + `setTimeout` copies that used to
 * live across the trace drawer / toolbar.
 *
 * `copy(text)` writes to the clipboard and — only once the write actually
 * resolves — flips `copied` true for {@link COPY_FEEDBACK_MS}, then back.
 * Awaiting the promise keeps the confirmation honest: on permission-denied
 * (Safari private mode, non-secure contexts) nothing reached the clipboard,
 * so we must not claim success. Rejections are swallowed: the surfaces are
 * tiny buttons with no slot for an error string, and the user can retry.
 *
 * Rapid repeat copies coalesce onto a single timer (each call re-arms it),
 * and the timer is cleared on unmount so a pending reset can't fire into an
 * unmounted component.
 */
export function useCopyToClipboard(): {
  copied: boolean;
  copy: (text: string) => void;
} {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const copy = useCallback(
    (text: string) => {
      void navigator.clipboard
        .writeText(text)
        .then(() => {
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
    [clearTimer]
  );

  return { copied, copy };
}
