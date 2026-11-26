import type { KeyboardEvent } from "react";
import { useState } from "react";

export type HoverReveal = {
  isRevealed: boolean;
  revealHandlers: {
    tabIndex: 0;
    onPointerEnter: () => void;
    onFocus: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  };
};

/**
 * Reports whether a results cell was ever pointed at or focused, so its hover-only action bar is
 * drawn for the cells someone reaches instead of for every cell of the run. The cell is one tab
 * stop: focusing it draws the actions, and Enter or Space on the cell itself expands it.
 */
export function useHoverReveal({ onExpand }: { onExpand: () => void }): HoverReveal {
  const [isRevealed, setIsRevealed] = useState(false);
  const reveal = (): void => setIsRevealed(true);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onExpand();
  };
  return {
    isRevealed,
    revealHandlers: { tabIndex: 0, onPointerEnter: reveal, onFocus: reveal, onKeyDown },
  };
}
