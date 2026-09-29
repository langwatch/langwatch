/**
 * The ask bar at the top of every board, after the reference: a pill with a
 * soft gradient edge, a sparkle, the purple prompt and an "Ask" chip. It is a
 * button, never a text field: pressing it opens the question picker.
 */

import { Box, chakra } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";

/** The reference's hover ring: purple at a tenth, outside the gradient edge. */
const HALO = "0 0 0 4px color-mix(in srgb, var(--chakra-colors-purple-500) 10%, transparent)";

export function BoardAskBar({ onOpen }: { onOpen: () => void }) {
  return (
    <Box
      marginX="auto"
      marginBottom={4}
      maxWidth="640px"
      width="full"
      borderRadius="full"
      padding="1px"
      bgGradient="to-r"
      gradientFrom="purple.400/60"
      gradientVia="pink.400/40"
      gradientTo="teal.400/50"
      transition="box-shadow 0.15s"
      _hover={{ boxShadow: HALO }}
      _focusWithin={{ boxShadow: HALO }}
    >
      <chakra.button
        type="button"
        aria-haspopup="dialog"
        onClick={onOpen}
        display="flex"
        alignItems="center"
        width="full"
        height="40px"
        gap={2.5}
        paddingX={4}
        borderRadius="full"
        background="bg.panel"
        cursor="pointer"
        outline="none"
        textAlign="start"
      >
        <Box as="span" flexShrink={0} color="purple.600" display="flex">
          <Sparkles size={15} aria-hidden />
        </Box>
        <Box as="span" flex={1} minWidth={0} fontSize="sm" fontWeight="medium" color="purple.600">
          What would you like to know?
        </Box>
        <Box
          as="span"
          aria-hidden
          flexShrink={0}
          borderRadius="full"
          paddingX={2}
          paddingY={0.5}
          background="purple.50"
          color="purple.600"
          fontSize="11px"
          fontWeight="medium"
        >
          Ask
        </Box>
      </chakra.button>
    </Box>
  );
}
