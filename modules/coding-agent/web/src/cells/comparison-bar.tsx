import { Box } from "@chakra-ui/react";
import type React from "react";

/**
 * How this row's value compares to the largest on the page, drawn quietly
 * enough that the number stays the thing being read.
 */
export const ComparisonBar: React.FC<{ value: number; largest: number }> = ({ value, largest }) => (
  <Box height="3px" bg="border.subtle" borderRadius="full" overflow="hidden">
    <Box
      height="full"
      width={`${largest > 0 ? (value / largest) * 100 : 0}%`}
      bg="blue.fg"
      borderRadius="full"
    />
  </Box>
);
