import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Users } from "lucide-react";
import type React from "react";

/**
 * Shown on the billing page when the organization uses more seats than its
 * plan includes, which is what a plan shrinking under a full organization
 * leaves behind. Everyone keeps access; the callout says what is over and
 * what to do about it.
 */
export function SeatLimitCallout({
  message,
  action,
}: {
  message: string;
  action: React.ReactNode;
}) {
  return (
    <Box
      data-testid="seat-limit-callout"
      borderWidth="1px"
      borderColor="orange.muted"
      backgroundColor="orange.subtle"
      borderRadius="lg"
      padding={5}
      width="full"
    >
      <HStack align="start" gap={4}>
        <Box color="orange.fg" paddingTop={1}>
          <Users size={20} />
        </Box>
        <VStack align="start" gap={1} flex={1}>
          <Text fontWeight="medium">
            Your organization has more members than your plan includes
          </Text>
          <Text color="fg.muted" fontSize="sm">
            {message} {action}
          </Text>
        </VStack>
      </HStack>
    </Box>
  );
}
