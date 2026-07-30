import { Box, HStack, Icon, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronRight, Settings2 } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { formatPreview } from "../../../utils/previewFormatter";

const SYSTEM_PROMPT_LONG_THRESHOLD = 280;

export const SystemPromptBanner: React.FC<{ text: string }> = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  // Run system-prompt text through the shared formatter so JSON envelopes
  // (`{"text": "…"}`), Anthropic typed blocks, and stray markdown noise
  // get unwrapped before display. Newlines stay intact (`pre-wrap` below
  // wants real `\n`s for line breaks); we just kill the literal fences and
  // image markdown that would otherwise survive into the banner.
  const formatted = useMemo(
    () =>
      formatPreview(text, {
        maxChars: 100_000,
        newlines: "preserve",
        stripMarkdownNoise: true,
      }).text,
    [text],
  );
  const isLong = formatted.length > SYSTEM_PROMPT_LONG_THRESHOLD;
  return (
    <Box
      borderRadius="lg"
      borderWidth="1px"
      borderColor="border.muted"
      bg="bg.subtle"
      overflow="hidden"
    >
      <HStack
        gap={2}
        paddingX={3}
        paddingY={2}
        cursor={isLong ? "pointer" : "default"}
        onClick={isLong ? () => setExpanded((v) => !v) : undefined}
        _hover={isLong ? { bg: "bg.muted" } : undefined}
      >
        <Icon as={Settings2} boxSize="13px" color="fg.muted" />
        <Text
          textStyle="2xs"
          fontWeight="600"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="0.06em"
        >
          System
        </Text>
        <Box flex={1} />
        {isLong && (
          <Icon
            as={expanded ? ChevronDown : ChevronRight}
            boxSize="13px"
            color="fg.subtle"
          />
        )}
      </HStack>
      <Box
        paddingX={3}
        paddingBottom={2.5}
        paddingTop={0.5}
        borderTopWidth="1px"
        borderTopColor="border.muted"
      >
        <Text
          textStyle="xs"
          color="fg.muted"
          whiteSpace="pre-wrap"
          lineHeight="1.6"
          lineClamp={isLong && !expanded ? 3 : undefined}
        >
          {formatted}
        </Text>
      </Box>
    </Box>
  );
};
