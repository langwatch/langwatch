/**
 * The scrolling content column of an Agent Testing surface.
 * @see specs/features/agent-testing/page-structure.feature
 */

import { Box, type BoxProps, VStack } from "@chakra-ui/react";

/** How wide the column is allowed to grow beside a rail. */
export const CONTENT_COLUMN_MAX_WIDTH = "1100px";

/**
 * How wide the column is allowed to grow with no rail beside it.
 */
export const CONTENT_COLUMN_WIDE_MAX_WIDTH = "1280px";

/** The width from which the rail is paid back on the right. */
export const CONTENT_COLUMN_CENTERING_WIDTH = 1600;

/**
 * The padding on the left of the column. A rail is paid back together with it,
 * so the column centres on the page rather than on the rail's inner edge.
 */
export const CONTENT_COLUMN_GUTTER = 32;

export type ContentColumnProps = BoxProps & {
  /** How wide the column may grow. Defaults to the width used beside a rail. */
  columnMaxWidth?: string;
  /**
   * The width of the rail on the left of this column, in pixels. The column
   * pays it back on the right on a wide window. Zero for a surface with no
   * rail.
   */
  railWidth?: number;
};

export function ContentColumn({
  railWidth = 0,
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
      css={
        railWidth > 0
          ? {
              [`@media (min-width: ${CONTENT_COLUMN_CENTERING_WIDTH}px)`]: {
                paddingRight: `${railWidth}px`,
              },
            }
          : undefined
      }
      {...boxProps}
    >
      <VStack align="stretch" gap={3} width="full" maxWidth={columnMaxWidth} marginX="auto">
        {children}
      </VStack>
    </Box>
  );
}
