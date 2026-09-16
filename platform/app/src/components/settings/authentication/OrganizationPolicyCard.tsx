import { Box, HStack, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { JoinPolicyCard } from "~/components/access/JoinPolicyCard";
import { TwoStepRequirementCard } from "~/components/members/TwoStepRequirementCard";
import { useJoinRequests } from "~/components/members/useJoinRequests";
import { useTwoStepRequirement } from "~/components/members/useTwoStepRequirement";
import { SessionLimitCard, SignInLockoutCard } from "./SignInSecurityCards";
import { useSignInSecurity } from "./useSignInSecurity";

/**
 * The rules this organization applies to everybody, together.
 *
 * They were stacked full-width, each under a section heading of its own, below
 * two cards that answer the harder questions in six short rows — so the least
 * consequential third of the page took two thirds of its height. An
 * administrator arriving to check a switch scrolled past four hundred words to
 * find it.
 *
 * All four sit side by side and headingless in one grid: who can join,
 * whether a second factor is required, when an account locks, and how long a
 * session lasts. The page reads as cards in rows rather than as cards and an
 * essay, and each card's own title is the heading it already needed.
 *
 * The two sign-in security rules were briefly a single full-width panel under
 * the grid, on the theory that two numbers in two sections earn the room. They
 * did not: it broke the two-column rhythm and gave four two-digit numbers
 * input boxes the width of the screen. They are two cards in the same grid.
 *
 * While a connection is registered but not live, the whole section is shown
 * dimmed and inert under one notice — see `HeldUntilConnectionLive`, and note
 * that "no connection at all" is deliberately not that state.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
export function OrganizationPolicyCard({
  organizationId,
  canManage,
  ssoLive = false,
  awaitingConnection = false,
}: {
  organizationId: string;
  /** `organization:manage`: every rule here is a membership or a security
   *  setting read and write. */
  canManage: boolean;
  /** A live connection answers the arrivals question for its own people;
   *  the join policy card points at that door when it exists. */
  ssoLive?: boolean;
  /**
   * A connection is registered here but is not live yet, so these rules are
   * held back until it is.
   *
   * NOT the same as "no single sign-on". An organization that never
   * federates has no connection at all and keeps every rule here, because
   * these govern exactly the people who arrive WITHOUT single sign-on — the
   * ones an organization mid-setup still has, and the only ones it will have
   * until the connection goes live. Holding them back for an organization
   * that does not federate would withhold them from their only audience.
   */
  awaitingConnection?: boolean;
}) {
  const joinRequests = useJoinRequests({ organizationId, canManage });
  const twoStep = useTwoStepRequirement({ organizationId, canManage });
  const signInSecurity = useSignInSecurity({ organizationId, canManage });

  if (awaitingConnection) {
    return (
      <HeldUntilConnectionLive>
        <PolicyGrid
          joinRequests={joinRequests}
          twoStep={twoStep}
          signInSecurity={signInSecurity}
          ssoLive={ssoLive}
        />
      </HeldUntilConnectionLive>
    );
  }

  return (
    <PolicyGrid
      joinRequests={joinRequests}
      twoStep={twoStep}
      signInSecurity={signInSecurity}
      ssoLive={ssoLive}
    />
  );
}

/**
 * The rules, shown but not yet usable, under one notice.
 *
 * SHOWN RATHER THAN HIDDEN, because what an administrator is about to be able
 * to configure is worth knowing while they finish the step in front of them —
 * a section that simply appears later reads as something that was missing.
 * Dimmed and inert, with one sentence saying when it opens.
 *
 * `inert` rather than only `pointerEvents: none`: the latter stops a mouse and
 * nothing else, so every switch and box inside stays reachable by keyboard and
 * still announced to a screen reader as an available control.
 */
function HeldUntilConnectionLive({ children }: { children: ReactNode }) {
  return (
    <VStack align="stretch" gap={3} width="full">
      <HStack
        gap={2}
        align="start"
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        paddingX={3.5}
        paddingY={2.5}
        data-testid="organization-policy-held"
      >
        <Box color="fg.muted" marginTop="1px" flexShrink={0}>
          <Lock size={14} />
        </Box>
        <Text fontSize="12px" lineHeight="1.55" color="fg.muted">
          These rules open up once your connection is live. Finish setting it up
          above, and how people join and how they sign in become yours to set
          here.
        </Text>
      </HStack>

      <Box inert opacity={0.45} data-testid="organization-policy-dimmed">
        {children}
      </Box>
    </VStack>
  );
}
/** The four rules, side by side. */
function PolicyGrid({
  joinRequests,
  twoStep,
  signInSecurity,
  ssoLive,
}: {
  joinRequests: ReturnType<typeof useJoinRequests>;
  twoStep: ReturnType<typeof useTwoStepRequirement>;
  signInSecurity: ReturnType<typeof useSignInSecurity>;
  ssoLive: boolean;
}) {
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
