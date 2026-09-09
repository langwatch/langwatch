/**
 * Text that is clamped to its cell and readable in full on hover.
 *
 * `platform/app`'s `HoverableBigText` is what the automations list used, and it
 * was REFUSED promotion to the Design System during the shared-component pass:
 * it carries an expand-to-dialog path with a JSON/markdown renderer, and
 * promoting that needs a render-prop seam nobody has designed yet
 * (`dev/docs/plans/ui-family-move-manifests.md`). Every use in this family
 * passed `expandable={false}`, so what this family actually needs is the other
 * half — clamp, measure, and offer the whole string in a tooltip when it does
 * not fit — and that is what this is.
 *
 * The measurement is a post-layout probe rather than a CSS query because there
 * is no CSS query for "was this clamped": the element's scroll size against its
 * offset size is the only thing that knows, and it only knows after the browser
 * has laid the box out.
 */

import { Box, type BoxProps } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useEffect, useRef, useState } from "react";

/** Long enough to read, short enough that a tooltip stays a tooltip. */
const TOOLTIP_LIMIT = 2000;

export function ClampedText({
  children,
  lineClamp = 7,
  ...props
}: BoxProps & { lineClamp?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOverflown, setIsOverflown] = useState(false);

  // Re-measured after every render, once the browser has laid the box out. The
  // handle is cleared on unmount and before the next render's probe, so a
  // pending measurement can never run against a torn-down document.
  useEffect(() => {
    const timeout = setTimeout(() => {
      const element = ref.current;
      setIsOverflown(
        element
          ? Math.abs(element.offsetWidth - element.scrollWidth) > 2 ||
              Math.abs(element.offsetHeight - element.scrollHeight) > 2
          : false,
      );
    }, 100);
    return () => clearTimeout(timeout);
  });

  const full = typeof children === "string" ? children : void 0;

  return (
    <Tooltip
      disabled={!isOverflown}
      content={
        <Box whiteSpace="pre-wrap">
          {full !== void 0
            ? full.slice(0, TOOLTIP_LIMIT) + (full.length > TOOLTIP_LIMIT ? "..." : "")
            : children}
        </Box>
      }
    >
      <Box
        ref={ref}
        width="full"
        height="full"
        whiteSpace="normal"
        lineClamp={lineClamp}
        {...props}
      >
        {children}
      </Box>
    </Tooltip>
  );
}
