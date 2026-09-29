import { Badge, HStack, Text } from "@chakra-ui/react";
import type { MemberSecondFactor } from "./useTwoStepRequirement";

/**
 * What one member can prove, in the members table.
 *
 * Every member says something — there is no blank cell — because a blank one
 * reads as "not loaded" and an administrator scanning for the people they
 * need to chase cannot tell the two apart.
 *
 * Nothing here is anybody's secret, anybody's codes or anybody's device. The
 * cell says only whether a second factor can be proved and, where it can,
 * what kind. A member list that named devices would be a directory of what to
 * steal.
 */
export function SecondFactorCell({
  member,
  mfaRequired,
}: {
  member: MemberSecondFactor | undefined;
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
      <Badge
        colorPalette={mfaRequired ? "red" : "gray"}
        data-testid="second-factor-no"
      >
        {mfaRequired ? "Waiting to set up" : "Not set up"}
      </Badge>
      {member.passkeyCount > 0 ? (
        // The one nuance an administrator needs, and the reason a held member
        // with a passkey is not a mystery: a passkey counts through the
        // SIGN-IN that used it, so this person is one sign-in away rather
        // than one setup away.
        <Text
          fontSize="xs"
          color="fg.muted"
          data-testid="second-factor-passkey"
        >
          Has a passkey
        </Text>
      ) : null}
    </HStack>
  );
}
