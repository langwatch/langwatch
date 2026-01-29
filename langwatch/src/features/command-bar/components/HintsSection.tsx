import { useState } from "react";
import { Box, HStack, Text } from "@chakra-ui/react";
import { Lightbulb } from "lucide-react";
import { HINTS } from "../constants";

/**
 * Hints section showing tips to help users.
 * Displays a random tip that stays stable for the session.
 */
export function HintsSection() {
  // Pick a random hint on mount (stable for the session)
  const [hintIndex] = useState(() => Math.floor(Math.random() * HINTS.length));
  const hint = HINTS[hintIndex];

  return (
    <HStack
      borderTop="1px solid"
      borderColor="border.muted"
      px={4}
      py={2}
      gap={2}
      fontSize="12px"
      color="fg.muted"
    >
      <Box color="yellow.500" flexShrink={0}>
        <Lightbulb size={14} />
      </Box>
      <Text>
        <Text as="span" fontWeight="medium">
          Tip:
        </Text>{" "}
        {hint}
      </Text>
    </HStack>
  );
}
