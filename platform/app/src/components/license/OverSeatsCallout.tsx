import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { UserMinus } from "lucide-react";

interface OverSeatsCalloutProps {
  currentMembers: number;
  maxMembers: number;
}

/**
 * Shown when an organization holds more active members than the seats its
 * license covers.
 *
 * A deployment runs uncapped before it buys a license, so this is the normal
 * state right after activation rather than an error. Activation is never
 * blocked and nobody is signed out; the admin is asked to choose who keeps a
 * seat, and only new members are refused until they do. See
 * seat-reconciliation.feature.
 */
export function OverSeatsCallout({
  currentMembers,
  maxMembers,
}: OverSeatsCalloutProps) {
  const overBy = currentMembers - maxMembers;

  if (overBy <= 0) return null;

  return (
    <Box
      borderWidth="1px"
      borderColor="orange.emphasized"
      backgroundColor="orange.subtle"
      borderRadius="lg"
      padding={5}
      width="full"
      marginBottom={4}
      data-testid="over-seats-callout"
      _dark={{ backgroundColor: "orange.950", borderColor: "orange.700" }}
    >
      <HStack align="start" gap={4}>
        <Box color="orange.fg" paddingTop={1}>
          <UserMinus size={20} />
        </Box>
        <VStack align="start" gap={2} flex={1}>
          <Text fontWeight="medium">
            {overBy === 1
              ? "One member is over the seats your license covers"
              : `${overBy} members are over the seats your license covers`}
          </Text>
          <Text color="fg.muted" fontSize="sm">
            Your license covers {maxMembers}{" "}
            {maxMembers === 1 ? "seat" : "seats"} and {currentMembers} members
            are active. Everyone keeps working, but you cannot add anyone new
            until you are back within {maxMembers}. Disable the members who no
            longer need access, or talk to us about more seats.
          </Text>
          <HStack gap={3} paddingTop={1}>
            <Button asChild size="sm" colorPalette="orange">
              <a href="/settings/members">Choose who to disable</a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href="mailto:enterprise@langwatch.ai">Get more seats</a>
            </Button>
          </HStack>
        </VStack>
      </HStack>
    </Box>
  );
}
