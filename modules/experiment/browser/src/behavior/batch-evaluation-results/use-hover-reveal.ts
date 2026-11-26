import { useState } from "react";

export type HoverReveal = {
  isRevealed: boolean;
  revealHandlers: { onPointerEnter: () => void; onFocus: () => void };
};

/**
 * Reports whether a results cell was ever pointed at or focused, so its hover-only action bar is
 * drawn for the cells someone reaches instead of for every cell of the run.
 */
export function useHoverReveal(): HoverReveal {
  const [isRevealed, setIsRevealed] = useState(false);
  const reveal = (): void => setIsRevealed(true);
  return { isRevealed, revealHandlers: { onPointerEnter: reveal, onFocus: reveal } };
}
