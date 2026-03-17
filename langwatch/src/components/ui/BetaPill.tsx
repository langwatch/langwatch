import { Badge, HStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PopoverAnchor,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
} from "./popover";

/**
 * BetaPill indicates a feature is in beta.
 *
 * Displays a small "Beta" pill badge. On hover, keyboard focus, or click,
 * a popover appears with a customizable message that supports
 * rich content (styled text, clickable links, etc.). Clicking the pill
 * toggles the popover open/closed.
 *
 * Can optionally wrap content (children) to place the badge alongside it,
 * or be used standalone (e.g. as a rightElement in a menu item).
 *
 * @param children - Optional content to wrap (e.g. a page heading)
 * @param message - ReactNode rendered inside the popover on hover/focus
 */
export function BetaPill({
  children,
  message,
}: {
  children?: ReactNode;
  message: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const handleOpen = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    closeTimeoutRef.current = setTimeout(() => {
      setOpen(false);
    }, 150);
  }, []);

  const handlePopoverEnter = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const handlePopoverLeave = useCallback(() => {
    handleClose();
  }, [handleClose]);

  const pill = (
    <PopoverRoot
      open={open}
      onOpenChange={({ open: isOpen }) => setOpen(isOpen)}
      positioning={{ placement: "bottom-start" }}
    >
      <PopoverAnchor asChild>
        <Badge
          size="sm"
          variant="subtle"
          colorPalette="purple"
          cursor="pointer"
          tabIndex={0}
          onMouseEnter={handleOpen}
          onMouseLeave={handleClose}
          onFocus={handleOpen}
          onBlur={handleClose}
          onClick={() => setOpen((prev) => !prev)}
        >
          Beta
        </Badge>
      </PopoverAnchor>
      <PopoverContent
        onMouseEnter={handlePopoverEnter}
        onMouseLeave={handlePopoverLeave}
      >
        <PopoverBody>{message}</PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );

  if (!children) {
    return pill;
  }

  return (
    <HStack gap={2} align="center">
      {children}
      {pill}
    </HStack>
  );
}
