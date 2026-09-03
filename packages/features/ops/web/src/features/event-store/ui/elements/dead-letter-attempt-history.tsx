import { Badge, Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import type { DeadLetterAttempt } from "../../model/dead-letter-types";

export function DeadLetterAttemptHistory({
  isPending,
  attempts,
}: {
  isPending: boolean;
  attempts: DeadLetterAttempt[];
}) {
  if (isPending) return <Spinner size="xs" />;
  if (attempts.length === 0) {
    return (
      <Text textStyle="xs" color="fg.muted">
        No recorded attempts — this message was retired before failures were recorded per attempt.
      </Text>
    );
  }
  return (
    <Box>
      <Text textStyle="2xs" color="fg.muted" marginBottom={1}>
        Attempts
      </Text>
      <VStack align="stretch" gap={1}>
        {attempts.map((row) => (
          // Keyed by row id, not attempt number: a redrive resets the count,
          // so one message can hold two entries numbered 1.
          <HStack key={row.id} gap={2} align="start" data-testid={`dead-attempt-${row.attempt}`}>
            <Badge
              size="xs"
              colorPalette={row.outcome === "dead" ? "red" : "orange"}
              variant="subtle"
              flexShrink={0}
            >
              {row.attempt}
            </Badge>
            <Text textStyle="xs" fontFamily="mono" color="red.500">
              {row.errorType}
            </Text>
            <Text textStyle="xs" color="fg.muted">
              {row.errorMessage}
            </Text>
          </HStack>
        ))}
      </VStack>
    </Box>
  );
}
