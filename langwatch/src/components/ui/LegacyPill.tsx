import { Badge, HStack } from "@chakra-ui/react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PopoverAnchor,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
} from "./popover";

/**
 * Flags a feature as legacy with an inline, dismissable explanation so we
 * can steer users toward the replacement without a hard cutover. The
 * popover (rather than a tooltip) lets the message carry links to the new
 * surface, and the open-on-hover/focus/click behaviour keeps it reachable
 * by both pointer and keyboard.
 */
export function LegacyPill({
  children,
  message,
  label = "Legacy",
}: {
  children?: ReactNode;
  message: ReactNode;
  label?: string;
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
          variant="subtle"
          colorPalette={"red"}
          fontSize="2xs"
          paddingX={1.5}
          lineHeight={1.2}
          cursor="pointer"
          tabIndex={0}
          role="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onMouseEnter={handleOpen}
          onMouseLeave={handleClose}
          onFocus={handleOpen}
          onBlur={handleClose}
          onClick={(e: MouseEvent) => {
            // Pill renders inside SideMenuLink's <Link href>, so a bare
            // stopPropagation still lets the browser follow the anchor.
            // preventDefault on the mouse path (the keyboard path below
            // already calls it) keeps the click purely a popover toggle.
            e.stopPropagation();
            e.preventDefault();
            setOpen((prev) => !prev);
          }}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              setOpen((prev) => !prev);
            }
          }}
        >
          {label}
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
