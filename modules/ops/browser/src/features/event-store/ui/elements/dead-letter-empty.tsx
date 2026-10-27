import { Card } from "@langwatch/design-system/card";
import { Box, HStack, Text } from "@langwatch/design-system/primitives";
import { Skull } from "lucide-react";

/**
 * The all-clear. Kept as a full statement rather than an empty page: a
 * visible zero is how the operator knows the panel is live and the fleet
 * is clean, not the same as a page that rendered nothing.
 */
export function DeadLettersEmpty() {
  return (
    <Card padding="lg">
      <HStack gap={3}>
        <Skull size={16} />
        <Box>
          <Text textStyle="sm" fontWeight="medium">
            No dead messages
          </Text>
          <Text textStyle="xs" color="fg.muted">
            Every intent the substrate has emitted either dispatched or is still being retried.
          </Text>
        </Box>
      </HStack>
    </Card>
  );
}
