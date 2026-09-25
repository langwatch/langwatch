/**
 * What one member can prove, in the members table. Every member says something,
 * because a blank cell reads as "not loaded". Never names a device or a code.
 */
import { Badge, HStack, Text } from "@chakra-ui/react";
import type { OrganizationMemberFactor } from "@langwatch/identity-contract";

export function SecondFactorCell({
  member,
  mfaRequired,
}: {
  member: OrganizationMemberFactor | undefined;
  mfaRequired: boolean;
}) {
  if (!member) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Not known
      </Text>
    );
  }

  if (member.satisfaction.satisfied) {
    return (
      <HStack gap={2}>
        <Badge colorPalette="green" data-testid="second-factor-yes">
          Set up
        </Badge>
      </HStack>
    );
  }

  return (
    <HStack gap={2}>
      <Badge colorPalette={mfaRequired ? "red" : "gray"} data-testid="second-factor-no">
        {mfaRequired ? "Waiting to set up" : "Not set up"}
      </Badge>
      {/* A passkey counts through the sign-in that used it: one sign-in away, not one setup. */}
      {member.passkeyCount > 0 ? (
        <Text fontSize="xs" color="fg.muted" data-testid="second-factor-passkey">
          Has a passkey
        </Text>
      ) : null}
    </HStack>
  );
}
