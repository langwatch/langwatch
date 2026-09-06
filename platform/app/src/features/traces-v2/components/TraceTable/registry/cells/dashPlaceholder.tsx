import { Box } from "@chakra-ui/react";

/**
 * Missing-value placeholder used by every table cell that renders
 * `{value || dash}` / `{value != null ? format(value) : dash}`.
 *
 * Rendered at opacity 0.5 so empty cells recede instead of fighting
 * for visual attention against rows that actually have a value — the
 * operator's eye should be drawn to the data, not the gaps.
 */
export const dash = (
  <Box as="span" opacity={0.5}>
    —
  </Box>
);
