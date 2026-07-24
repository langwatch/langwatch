/**
 * useInteractiveTooltip - Hook for manually managing interactive tooltip state.
 *
 * This hook is needed when a tooltip contains nested tooltips inside its content.
 * Chakra's built-in `interactive` prop conflicts with nested tooltips, causing
 * the parent tooltip to close unexpectedly when hovering over inner tooltips.
 *
 * By manually controlling open/close state and passing mouse handlers to both
 * the trigger element and the tooltip's contentProps, we can properly handle
 * the hover behavior while allowing nested tooltips to work correctly.
 *
 * Usage:
 * ```tsx
 * const { isOpen, handleMouseEnter, handleMouseLeave } = useInteractiveTooltip(150);
 *
 * <Tooltip
 *   content={<TooltipContent />}
 *   contentProps={{
 *     onMouseEnter: handleMouseEnter,
 *     onMouseLeave: handleMouseLeave,
 *   }}
 *   open={isOpen}
 *   interactive
 * >
 *   <TriggerElement
 *     onMouseEnter={handleMouseEnter}
 *     onMouseLeave={handleMouseLeave}
 *   />
 * </Tooltip>
 * ```
 */
import { useCallback, useRef, useState } from "react";

/**
 * Hook to manage interactive tooltip state with proper hover behavior.
 *
 * @param closeDelay - Delay in ms before closing the tooltip after mouse leaves.
 *                     This handles the gap between trigger and tooltip content.
 *                     Default: 150ms
 */
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
