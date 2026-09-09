/**
 * Text that shows its full value in a tooltip only when it is actually clipped.
 *
 * A FAMILY-LOCAL COPY of `platform/app/src/components/OverflownText.tsx`, which
 * stays for its remaining consumers. `@langwatch/trace-web` and
 * `@langwatch/prompt-web` each carry one; this is the third, and only the one
 * export the members table calls.
 */

import { Box, type BoxProps } from "@chakra-ui/react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@langwatch/design-system/tooltip";

export function OverflownTextWithTooltip({
  children,
  ...props
}: Omit<BoxProps, "label"> & {
  label?: React.ReactNode | string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOverflown, setIsOverflown] = useState(false);

  useEffect(() => {
    const element = ref.current;

    if (!element) return;

    setIsOverflown(element.scrollHeight > element.clientHeight);
  }, []);

  return (
    <Tooltip
      content={props.label ?? children}
      disabled={!isOverflown}
      positioning={{ placement: "top" }}
    >
      <Box ref={ref} lineClamp={props.lineClamp ?? 1} {...(props as BoxProps)}>
        {children}
      </Box>
    </Tooltip>
  );
}
