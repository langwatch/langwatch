import { Box, HStack } from "@chakra-ui/react";

const pulsingDotCss = {
  "@keyframes pulseOpacity": {
    "0%, 100%": { opacity: 0.3 },
    "50%": { opacity: 1 },
  },
};

function PulsingDot({ delay }: { delay: string }) {
  return (
    <Box
      as="span"
      fontSize="sm"
      color="fg.muted"
      css={{
        ...pulsingDotCss,
        animation: `pulseOpacity 1.4s ease-in-out ${delay} infinite`,
      }}
    >
      ●
    </Box>
  );
}

/**
 * Three animated dots indicating that the system is processing.
 * Left-aligned to match assistant message bubble positioning.
 */
export function ThinkingIndicator() {
  return (
    <HStack
      role="status"
      aria-label="Processing"
      gap={1}
      paddingY={2}
      paddingX={1}
      justify="flex-start"
    >
      <PulsingDot delay="0s" />
      <PulsingDot delay="0.2s" />
      <PulsingDot delay="0.4s" />
    </HStack>
  );
}
