import { Box, Flex } from "@chakra-ui/react";
import type React from "react";

/**
 * Langy speaks like a chat: the logo avatar on the left, the words typing out
 * to its right, left-aligned, the whole block centred on the screen so the
 * text drifts up as more of it lands.
 */
export function TakeoverRow({
  fading,
  maxWidth,
  children,
}: {
  fading: boolean;
  maxWidth: number;
  children: React.ReactNode;
}) {
  return (
    <Flex
      w="full"
      maxW={`${maxWidth}px`}
      align="flex-start"
      gap={5}
      textAlign="left"
      transition="opacity 0.5s ease"
      opacity={fading ? 0 : 1}
      data-testid="takeover-row"
    >
      <Box asChild mt={1} h="44px" w="auto" flexShrink={0}>
        <img src="/images/logo-icon.svg" alt="Langy" />
      </Box>
      <Box minW={0} flex={1}>
        {children}
      </Box>
    </Flex>
  );
}
