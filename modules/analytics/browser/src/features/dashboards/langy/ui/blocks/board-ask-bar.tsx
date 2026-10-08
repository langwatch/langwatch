/**
 * The "What do you want to know?" bar, with suggested questions on one line on an empty
 * board. It looks like a search field but is a button: a click, or Enter or Space on focus,
 * opens the board's modal at once with the cursor in its own input, so it never holds text.
 */

import { Box, chakra, HStack, VStack } from "@langwatch/design-system/primitives";
import { Sparkles } from "lucide-react";

/** The prototype's hover ring: purple at a tenth, outside the gradient edge. */
const HALO = "0 0 0 4px color-mix(in srgb, var(--chakra-colors-purple-500) 10%, transparent)";

export function BoardAskBar({
  onOpen,
  chips = [],
  onAsk,
}: {
  /** Opens the board's modal: "Add a widget", or Langy on a read-only board. */
  onOpen: () => void;
  /** The suggested questions, asked of Langy on a click. */
  chips?: readonly string[];
  /** Puts a chip's question to Langy; absent when Langy is not available. */
  onAsk?: (question: string) => void;
}) {
  return (
    <VStack marginX="auto" marginBottom={5} maxWidth="640px" width="full" gap={2.5}>
      <Box
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
          aria-label="What do you want to know?"
          onClick={onOpen}
          display="flex"
          alignItems="center"
          width="full"
          height="40px"
          gap={2.5}
          paddingX={4}
          borderRadius="full"
          background="bg.panel"
          cursor="text"
          outline="none"
          textAlign="left"
        >
          <Box as="span" flexShrink={0} color="purple.600" display="flex">
            <Sparkles size={15} aria-hidden />
          </Box>
          <chakra.span
            flex={1}
            minWidth={0}
            truncate
            fontSize="sm"
            fontWeight="medium"
            color="purple.600/70"
          >
            What do you want to know?
          </chakra.span>
          <chakra.span
            flexShrink={0}
            borderRadius="full"
            paddingX={2.5}
            paddingY={0.5}
            background="purple.50"
            color="purple.600"
            fontSize="11px"
            fontWeight="medium"
          >
            Ask
          </chakra.span>
        </chakra.button>
      </Box>
      {onAsk && chips.length > 0 && (
        // One line: a narrow screen scrolls it from the first chip rather than clipping both ends.
        <HStack
          gap={1.5}
          justify={{ base: "flex-start", md: "center" }}
          flexWrap="nowrap"
          maxWidth="full"
          overflowX="auto"
          scrollbarWidth="none"
        >
          {chips.map((chip) => (
            <chakra.button
              key={chip}
              type="button"
              flexShrink={0}
              borderRadius="full"
              borderWidth="1px"
              borderColor="border"
              background="bg.panel"
              paddingX={2.5}
              paddingY={1}
              fontSize="12px"
              whiteSpace="nowrap"
              color="fg.muted"
              cursor="pointer"
              _hover={{ borderColor: "border.emphasized", color: "fg" }}
              onClick={() => onAsk(chip)}
            >
              {chip}
            </chakra.button>
          ))}
        </HStack>
      )}
    </VStack>
  );
}
