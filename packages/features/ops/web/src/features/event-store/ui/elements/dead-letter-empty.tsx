import { Box, Card, HStack, Text } from "@chakra-ui/react";
import { Skull } from "lucide-react";

/**
 * The all-clear.
 *
 * Kept as a full statement rather than an empty page: on an ops surface a
 * visible zero is how the operator knows the panel is live and the fleet is
 * clean, which is not the same thing as a page that rendered nothing.
 */
export function DeadLettersEmpty() {
  return (
    <Card.Root>
      <Card.Body padding={6}>
        <HStack gap={3}>
          <Skull size={16} />
          <Box>
            <Text textStyle="sm" fontWeight="medium">
              No dead messages
            </Text>
            <Text textStyle="xs" color="fg.muted">
              Every intent the substrate has emitted either dispatched or is still being
              retried.
            </Text>
          </Box>
        </HStack>
      </Card.Body>
    </Card.Root>
  );
}
