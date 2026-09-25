/**
 * What the reviewer meets instead of a conversation when the queued trace does
 * not resolve: it says so plainly and hands back a way on.
 */

import { Button, HStack, Text, VStack } from "@chakra-ui/react";

export function UnavailableTraceCard({
  canRemove,
  canSkip,
  isRemoving,
  isStale,
  onRemove,
  onSkip,
}: {
  canRemove: boolean;
  canSkip: boolean;
  isRemoving: boolean;
  /** The item this card was drawn from is the one the reviewer has left. */
  isStale: boolean;
  onRemove: () => void;
  onSkip: () => void;
}) {
  return (
    <VStack flex="1" justify="center" gap={4} paddingX={6} textAlign="center">
      <Text fontSize="lg" fontWeight="500">
        This trace is no longer available
      </Text>
      <Text color="fg.muted" maxWidth="480px">
        The trace behind this queue item cannot be found in this project, so there is nothing here
        to review.
      </Text>
      <HStack gap={3}>
        {canRemove && (
          <Button variant="outline" disabled={isRemoving || isStale} onClick={onRemove}>
            Remove from queue
          </Button>
        )}
        <Button colorPalette="blue" disabled={!canSkip || isStale} onClick={onSkip}>
          Skip
        </Button>
      </HStack>
    </VStack>
  );
}
