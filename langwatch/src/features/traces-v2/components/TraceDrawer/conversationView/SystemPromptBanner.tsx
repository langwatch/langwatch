import { Box, HStack, Icon, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronRight, Settings2 } from "lucide-react";
import type React from "react";
import { useState } from "react";

const SYSTEM_PROMPT_LONG_THRESHOLD = 280;

export const SystemPromptBanner: React.FC<{ text: string }> = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > SYSTEM_PROMPT_LONG_THRESHOLD;
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
          fontFamily="mono"
          color="fg.muted"
          whiteSpace="pre-wrap"
          lineHeight="1.6"
          lineClamp={isLong && !expanded ? 3 : undefined}
        >
          {text}
        </Text>
      </Box>
    </Box>
  );
};
