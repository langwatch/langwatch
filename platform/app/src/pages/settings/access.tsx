import { Heading, SimpleGrid, Skeleton, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { DomainVerificationSection } from "~/components/access/DomainVerificationSection";
import { JoinPolicyCard } from "~/components/access/JoinPolicyCard";
import SettingsLayout from "~/components/SettingsLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { TwoStepRequirementCard } from "../../components/members/TwoStepRequirementCard";
import { useJoinRequests } from "../../components/members/useJoinRequests";
import { useTwoStepRequirement } from "../../components/members/useTwoStepRequirement";

/**
 * The organization's rules about people, in one place.
 *
 * These two controls used to sit at the bottom of the members list, under a
 * table of forty names. They are not people — they are the conditions under
 * which somebody BECOMES one — and reading them as the tail of a member list
 * made them look like a footnote to it. An administrator answering "what are
 * our rules" was scrolling a directory to find out.
 *
 * Two rules and the thing that underwrites them:
 *
 *   - who may join without an invitation, and on what terms;
 *   - whether every member has to be able to prove a second factor;
 *   - which domains this organization has proved, since the first rule reads
 *     "verified address on your domain" and nothing else on screen used to
 *     say where that is settled.
 */
function AccessSettings() {
  const { organization, hasPermission } = useOrganizationTeamProject();
  const canManage = hasPermission("organization:manage");

  if (!organization) return <SettingsLayout />;

  return (
    <SettingsLayout>
      <AccessContent organizationId={organization.id} canManage={canManage} />
    </SettingsLayout>
  );
}

export default withPermissionGuard("organization:manage", {
  layoutComponent: SettingsLayout,
})(AccessSettings);

const JOINING_LABEL = {
  off: "Nobody joins",
  request: "By approval",
  auto: "Automatic",
} as const;

function AccessContent({
  organizationId,
  canManage,
}: {
  organizationId: string;
  canManage: boolean;
}) {
  const { hasPermission } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });
  const canViewSso = hasPermission("sso:view");

  const joinRequests = useJoinRequests({ organizationId, canManage });
  const twoStep = useTwoStepRequirement({ organizationId, canManage });
  // The same query the domains section below runs, so the tile and the list
  // cannot disagree — trpc serves both from one read.
  const setup = api.ssoSetup.getSetup.useQuery(
    { organizationId },
    { enabled: canViewSso && !!organizationId },
  );
  const verifiedDomains = setup.data?.connection?.verifiedDomains.length ?? 0;

  return (
    <VStack gap={6} width="full" align="start">
      <VStack align="start" gap={1} width="full">
        <Heading>Access</Heading>
        <Text color="fg.muted" fontSize="sm">
          The rules this organization applies to everybody in it.
        </Text>
      </VStack>

      {/* Where things stand, before any control: the four answers an
          administrator opens this page to check, each settled in detail by
          a card below. */}
      <SimpleGrid columns={{ base: 2, lg: 4 }} gap={3} width="full">
        <AccessFact label="Joining">
          {JOINING_LABEL[joinRequests.joining.domainJoin]}
        </AccessFact>
        <AccessFact label="Waiting to join">
          {joinRequests.requests.length === 0
            ? "Nobody"
            : `${joinRequests.requests.length} ${joinRequests.requests.length === 1 ? "person" : "people"}`}
        </AccessFact>
        <AccessFact label="Two-step verification">
          {twoStep.show
            ? twoStep.mfaRequired
              ? "Required"
              : "Optional"
            : "Optional"}
        </AccessFact>
        <AccessFact label="Domains verified">
          {canViewSso ? (
            setup.isLoading ? (
              <Skeleton height="4" width="10" />
            ) : (
              String(verifiedDomains)
            )
          ) : (
            "—"
          )}
        </AccessFact>
      </SimpleGrid>

      <SimpleGrid
        columns={{ base: 1, xl: 2 }}
        gap={4}
        width="full"
        alignItems="start"
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
        />

        {/* The card carries its own plan lock and its own copy; this page
            only decides where it sits. */}
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
      </SimpleGrid>

      <DomainVerificationSection
        organizationId={organizationId}
        canView={canViewSso}
      />
    </VStack>
  );
}

/** One answered question, in the stat-tile register the directory overview
 *  established: tracked eyebrow, plain value, hairline card. */
function AccessFact({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <VStack
      align="start"
      gap={1.5}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="lg"
      padding={3}
      background="bg.panel"
    >
      <Text
        fontSize="10px"
        fontWeight="medium"
        color="fg.subtle"
        textTransform="uppercase"
        letterSpacing="0.08em"
      >
        {label}
      </Text>
      <Text fontSize="sm" fontWeight="medium">
        {children}
      </Text>
    </VStack>
  );
}
