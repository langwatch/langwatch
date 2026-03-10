import { Badge, HStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "./popover";

/**
 * BetaPill wraps content to indicate a feature is in beta.
 *
 * Displays a small "Beta" pill badge alongside children. On hover or
 * keyboard focus, a popover appears with a customizable message that
 * supports rich content (styled text, clickable links, etc.).
 *
 * @param children - The content to wrap (e.g. a page heading)
 * @param message - ReactNode rendered inside the popover on hover/focus
 */
export function BetaPill({
  children,
  message,
}: {
  children: ReactNode;
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

  return (
    <HStack gap={2} align="center">
      {children}
      <PopoverRoot
        open={open}
        onOpenChange={({ open: isOpen }) => setOpen(isOpen)}
        positioning={{ placement: "bottom-start" }}
      >
        <PopoverTrigger asChild>
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
          >
            Beta
          </Badge>
        </PopoverTrigger>
        <PopoverContent
          onMouseEnter={handlePopoverEnter}
          onMouseLeave={handlePopoverLeave}
        >
          <PopoverBody>{message}</PopoverBody>
        </PopoverContent>
      </PopoverRoot>
    </HStack>
  );
}
