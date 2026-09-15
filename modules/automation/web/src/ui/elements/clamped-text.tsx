// Text clamped to cell with tooltip on hover; unlike HoverableBigText (expand-to-dialog), this
// just clamps and offers the full string in a tooltip when it doesn't fit.

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
