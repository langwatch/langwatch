/**
 * Manages interactive-tooltip open state by hand: Chakra's `interactive`
 * prop breaks when a tooltip nests another tooltip inside its content, so
 * this hook drives hover state directly for that case.
 */
import { useCallback, useRef, useState } from "react";

/** Interactive-tooltip state; `closeDelay` covers the trigger-to-content gap. */
export const useInteractiveTooltip = (closeDelay = 150) => {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearCloseTimeout();
    setIsOpen(true);
  }, [clearCloseTimeout]);

  const handleMouseLeave = useCallback(() => {
    clearCloseTimeout();
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, closeDelay);
  }, [closeDelay, clearCloseTimeout]);

  return {
    isOpen,
    handleMouseEnter,
    handleMouseLeave,
  };
};
