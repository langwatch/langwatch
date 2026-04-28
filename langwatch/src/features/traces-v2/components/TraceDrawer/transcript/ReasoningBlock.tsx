import { Box, HStack, Icon, Text } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { useState } from "react";
import { LuBrain, LuChevronDown, LuChevronRight } from "react-icons/lu";
import { RenderedMarkdown } from "../markdownView";

const thinkingMirror = keyframes`
  from { background-position: 200% center; }
  to { background-position: -200% center; }
`;

/**
 * Reasoning / chain-of-thought rendered as an accordion-style block with a
 * shiny mirror highlight drifting across the text.
 */
export function ReasoningBlock({
  text,
  defaultOpen = false,
}: {
  text: string;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Box mb="2" width="full">
      <HStack
        as="button"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        gap="1.5"
        color="fg.muted"
        _hover={{ color: "fg.default" }}
        cursor="pointer"
        textStyle="xs"
        fontWeight="medium"
        py="1"
        textAlign="left"
      >
        <Icon as={isOpen ? LuChevronDown : LuChevronRight} size="3" />
        <Icon as={LuBrain} size="3" />
        <Text>Reasoned</Text>
      </HStack>

      {isOpen && (
        <Box
          pos="relative"
          pl="4"
          borderStartWidth="1px"
          borderStartColor="border.muted"
          mt="1"
          mb="2"
          fontStyle="italic"
          // The shimmer gradient - higher contrast and more colorful for visibility
          backgroundImage="linear-gradient(110deg, var(--chakra-colors-fg-muted) 35%, var(--chakra-colors-blue-fg) 45%, var(--chakra-colors-purple-fg) 50%, var(--chakra-colors-blue-fg) 55%, var(--chakra-colors-fg-muted) 65%)"
          backgroundSize="200% auto"
          backgroundClip="text"
          WebkitBackgroundClip="text"
          // Make the text itself transparent so the background shows through
          color="transparent !important"
          animation={`${thinkingMirror} 3s linear infinite`}
          // Ensure all nested markdown elements inherit the transparency and background clip
          css={{
            "& *": {
              color: "inherit !important",
              background: "inherit !important",
              backgroundClip: "inherit !important",
              WebkitBackgroundClip: "inherit !important",
            },
          }}
        >
          <RenderedMarkdown markdown={text} paddingX={0} paddingY={0} />
        </Box>
      )}
    </Box>
  );
}
