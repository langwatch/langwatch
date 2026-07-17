/**
 * Keep the command surface around just long enough for the Langy panel to begin
 * opening underneath it. The two motions overlap, so Enter feels like one
 * handoff instead of a dialog closing followed by a second surface appearing.
 */
export const LANGY_HANDOFF_DURATION_MS = 180;

interface BeginLangyHandoffArgs {
  prompt: string;
  askLangy: (prompt: string) => void;
  closeCommandBar: () => void;
  reducedMotion: boolean;
  setExiting: (exiting: boolean) => void;
  schedule?: (callback: () => void, delayMs: number) => number;
}

/**
 * Opens Langy immediately, then retires the command bar after a short overlap.
 * Returns the scheduled timer so callers can cancel it when they unmount.
 */
export function beginLangyHandoff({
  prompt,
  askLangy,
  closeCommandBar,
  reducedMotion,
  setExiting,
  schedule = (callback, delayMs) => window.setTimeout(callback, delayMs),
}: BeginLangyHandoffArgs): number | null {
  if (!reducedMotion) setExiting(true);

  // Opening first is the continuity contract: the panel begins its entrance
  // while the command surface dissolves instead of waiting behind a blank gap.
  askLangy(prompt);

  if (reducedMotion) {
    closeCommandBar();
    return null;
  }

  return schedule(closeCommandBar, LANGY_HANDOFF_DURATION_MS);
}
