/**
 * The "What do you want to know?" bar, with suggested questions on one line on an empty
 * board. Typing hands the text to "Add a widget"; "Ask" and the chips go to Langy.
 */

import { Box, chakra, HStack, VStack } from "@langwatch/design-system/primitives";
import { Sparkles } from "lucide-react";
import { useState } from "react";

/** The prototype's hover ring: purple at a tenth, outside the gradient edge. */
const HALO = "0 0 0 4px color-mix(in srgb, var(--chakra-colors-purple-500) 10%, transparent)";

export function BoardAskBar({
  chips = [],
  onType,
  onAsk,
}: {
  /** The suggested questions, asked of Langy on a click. */
  chips?: readonly string[];
  /** Where the board takes widgets: the text as it is typed, to open "Add a widget" with. */
  onType?: (text: string) => void;
  /** Puts a question to Langy; absent when Langy is not available. */
  onAsk?: (question: string) => void;
}) {
  const [text, setText] = useState("");

  const submit = () => {
    if (onAsk) onAsk(text.trim());
    else onType?.(text);
    setText("");
  };

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
        <chakra.form
          display="flex"
          alignItems="center"
          height="40px"
          gap={2.5}
          paddingX={4}
          borderRadius="full"
          background="bg.panel"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Box as="span" flexShrink={0} color="purple.600" display="flex">
            <Sparkles size={15} aria-hidden />
          </Box>
          <chakra.input
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              onType?.(event.target.value);
            }}
            // Keys typed before "Add a widget" takes focus still land here; once it has
            // the text, the bar empties.
            onBlur={() => onType && setText("")}
            placeholder="What do you want to know?"
            aria-label="What do you want to know?"
            flex={1}
            minWidth={0}
            background="transparent"
            outline="none"
            fontSize="sm"
            fontWeight="medium"
            color="purple.700"
            _placeholder={{ color: "purple.600/70" }}
          />
          {onAsk && (
            <chakra.button
              type="submit"
              flexShrink={0}
              borderRadius="full"
              paddingX={2.5}
              paddingY={0.5}
              background="purple.50"
              color="purple.600"
              fontSize="11px"
              fontWeight="medium"
              cursor="pointer"
              _hover={{ background: "purple.100" }}
            >
              Ask
            </chakra.button>
          )}
        </chakra.form>
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
