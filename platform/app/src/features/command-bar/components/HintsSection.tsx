import { Box, HStack, Text } from "@chakra-ui/react";
import { Lightbulb } from "lucide-react";
import { useEffect, useState } from "react";
import { HINTS } from "../constants";

/**
 * Hints section showing tips to help users.
 * Displays a random tip that stays stable for the session.
 */
export function HintsSection() {
  // Initialize to 0 for SSR, then randomize on client to avoid hydration mismatch
  const [hintIndex, setHintIndex] = useState(0);

  useEffect(() => {
    setHintIndex(Math.floor(Math.random() * HINTS.length));
  }, []);

  const hint = HINTS[hintIndex];

  return (
    <HStack
      borderTop="1px solid"
      borderColor="border.subtle"
      px={{ base: 4, md: 5 }}
      py={2.5}
      gap={2.5}
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
