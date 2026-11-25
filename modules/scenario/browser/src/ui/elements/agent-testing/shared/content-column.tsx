/**
 * The scrolling content column of an Agent Testing surface.
 * @see specs/features/agent-testing/page-structure.feature
 */

import { Box, type BoxProps, VStack } from "@langwatch/design-system/primitives";

/** How wide the column is allowed to grow beside a rail. */
export const CONTENT_COLUMN_MAX_WIDTH = "1100px";

/**
 * How wide the column is allowed to grow with no rail beside it.
 */
export const CONTENT_COLUMN_WIDE_MAX_WIDTH = "1280px";

export type ContentColumnProps = BoxProps & {
  /** How wide the column may grow. Defaults to the width used beside a rail. */
  columnMaxWidth?: string;
};

export function ContentColumn({
  columnMaxWidth = CONTENT_COLUMN_MAX_WIDTH,
  children,
  ...boxProps
}: ContentColumnProps) {
  return (
    <Box
      flex={1}
      minWidth={0}
      width="full"
      height="full"
      overflow="auto"
      paddingX={8}
      paddingY={4}
      {...boxProps}
    >
      <VStack
        align="stretch"
        gap={3}
        width="full"
        minHeight="full"
        maxWidth={columnMaxWidth}
        marginX="auto"
      >
        {children}
      </VStack>
    </Box>
  );
}
