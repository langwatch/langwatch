/** Workflow's clamped text, as workflow lends it by token (ARCHITECTURE.md §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import { Box, type BoxProps } from "@langwatch/design-system/primitives";
import { HoverableBigTextToken, type HoverableBigTextProps } from "@langwatch/workflow-client";

/** The lent text in a box carrying this screen's type and width; plain text until it loads. */
export function HoverableBigText({
  children,
  lineClamp,
  expandedVersion,
  expandable,
  ...boxProps
}: HoverableBigTextProps & Omit<BoxProps, keyof HoverableBigTextProps>) {
  return (
    <Box {...boxProps}>
      <Lent
        of={HoverableBigTextToken}
        props={{ children, lineClamp, expandedVersion, expandable }}
        fallback={children}
      />
    </Box>
  );
}
