/**
 * The "What do you want to know?" bar, with suggested questions in full under it on an empty
 * board. It looks like a search field but is a button: a click, or Enter or Space on focus,
 * opens the board's modal at once with the cursor in its own input, so it never holds text.
 */

import { chakra, HStack, VStack } from "@langwatch/design-system/primitives";

import {
  ASK_BAR_PROMPT,
  ASK_BAR_PROMPT_COLOR,
  ASK_BAR_WORDS,
  AskBarShell,
  AskPill,
} from "../elements/ask-bar-shell.tsx";

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
      <AskBarShell onPress={onOpen}>
        <chakra.span truncate color={ASK_BAR_PROMPT_COLOR} {...ASK_BAR_WORDS}>
          {ASK_BAR_PROMPT}
        </chakra.span>
        <AskPill />
      </AskBarShell>
      {onAsk && chips.length > 0 && (
        // Wrapping, never scrolling or clipping: a chip cut at the row's edge reads as a typo.
        <HStack
          as="ul"
          aria-label="Suggested questions"
          gap={1.5}
          justify="center"
          flexWrap="wrap"
          width="full"
          margin={0}
          padding={0}
          listStyleType="none"
        >
          {chips.map((chip) => (
            <chakra.li key={chip} display="flex" maxWidth="full">
              <chakra.button
                type="button"
                maxWidth="full"
                borderRadius="full"
                borderWidth="1px"
                borderColor="border"
                background="bg.panel"
                paddingX={2.5}
                paddingY={1}
                fontSize="12px"
                lineHeight="18px"
                textAlign="center"
                color="fg.muted"
                cursor="pointer"
                _hover={{ borderColor: "border.emphasized", color: "fg" }}
                onClick={() => onAsk(chip)}
              >
                {chip}
              </chakra.button>
            </chakra.li>
          ))}
        </HStack>
      )}
    </VStack>
  );
}
