import { Box } from "@chakra-ui/react";

/**
 * Missing-value placeholder used by every table cell that renders `{value || dash}` /
 * `{value != null ? format(value) : dash}`.
 */
export const dash = (
  <Box as="span" opacity={0.5}>
    —
  </Box>
);
