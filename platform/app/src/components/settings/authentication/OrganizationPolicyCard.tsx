import { SimpleGrid } from "@chakra-ui/react";
import { JoinPolicyCard } from "~/components/access/JoinPolicyCard";
import { TwoStepRequirementCard } from "~/components/members/TwoStepRequirementCard";
import { useJoinRequests } from "~/components/members/useJoinRequests";
import { useTwoStepRequirement } from "~/components/members/useTwoStepRequirement";
import { SessionLimitCard, SignInLockoutCard } from "./SignInSecurityCards";
import { useSignInSecurity } from "./useSignInSecurity";

/** Organization policies apply independently of the SSO connection lifecycle. */
export function OrganizationPolicyCard({
  organizationId,
  canManage,
  ssoLive = false,
}: {
  organizationId: string;
  /** `organization:manage`: every rule here is a membership or a security
   *  setting read and write. */
  canManage: boolean;
  /** A live connection answers the arrivals question for its own people;
   *  the join policy card points at that door when it exists. */
  ssoLive?: boolean;
}) {
  const joinRequests = useJoinRequests({ organizationId, canManage });
  const twoStep = useTwoStepRequirement({ organizationId, canManage });
  const signInSecurity = useSignInSecurity({ organizationId, canManage });

  return (
    <SimpleGrid
      columns={{ base: 1, lg: 2 }}
      gap={4}
      width="full"
      alignItems="start"
      data-testid="organization-policy"
    >
      <JoinPolicyCard
        // Re-mounted when the saved setting changes, so the radio and the
        // domain box start from what was actually saved rather than from a
        // draft the reader has moved on from.
        key={`${joinRequests.joining.domainJoin}:${joinRequests.joining.joinDomains.join(",")}`}
        domainJoin={joinRequests.joining.domainJoin}
        joinDomains={joinRequests.joining.joinDomains}
        saving={joinRequests.savingJoining}
        onSave={joinRequests.setJoining}
        ssoLive={ssoLive}
      />
      {/* The card decides for itself whether a second step applies to this
            deployment at all, and draws nothing where it does not. */}
      {twoStep.show && (
        <TwoStepRequirementCard
          mfaRequired={twoStep.mfaRequired}
          heldCount={twoStep.heldCount}
          memberCount={twoStep.members.length}
          connection={twoStep.connection}
          saving={twoStep.saving}
          onChange={twoStep.setRequirement}
        />
      )}

      {/* The two sign-in security rules join the same grid rather than
          sitting full-width beneath it. They were one panel under the grid,
          which broke the two-column rhythm the page is built on and gave four
          two-digit numbers input boxes the width of the screen. Each is a
          separate decision, so each is a card, and the grid becomes three
          rows of two. */}
      {signInSecurity.show && (
        <>
          <SignInLockoutCard
            // Re-mounted on every saved value, the same reason JoinPolicyCard
            // is above: the drafts inside start from what was actually saved,
            // never from a value the reader has moved on from.
            key={`lockout:${signInSecurity.settings.lockoutAfterFailedAttempts}:${signInSecurity.settings.lockoutMinutes}`}
            settings={signInSecurity.settings}
            saving={signInSecurity.saving}
            onSave={signInSecurity.save}
          />
          <SessionLimitCard
            key={`session:${signInSecurity.settings.sessionIdleTimeoutMinutes}:${signInSecurity.settings.sessionMaxLifetimeMinutes}`}
            settings={signInSecurity.settings}
            saving={signInSecurity.saving}
            onSave={signInSecurity.save}
          />
        </>
      )}
    </SimpleGrid>
  );
}
