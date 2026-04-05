/** 1px border line + soft downward shadow, matching the prompt playground divider. */

import { Box } from "@chakra-ui/react";

export function ShadowDivider() {
  return (
    <Box width="full" flexShrink={0} position="relative">
      <Box
        width="full"
        height="1px"
        bg="border.muted"
      />
      <Box
        width="full"
        height="4px"
        background="linear-gradient(to bottom, var(--chakra-colors-border-muted), transparent)"
        opacity={0.4}
      />
    </Box>
  );
}
