import { SimpleGrid } from "@chakra-ui/react";
import { JoinPolicyCard } from "~/components/access/JoinPolicyCard";
import { TwoStepRequirementCard } from "~/components/members/TwoStepRequirementCard";
import { useJoinRequests } from "~/components/members/useJoinRequests";
import { useTwoStepRequirement } from "~/components/members/useTwoStepRequirement";

/**
 * The two rules this organization applies to everybody, side by side.
 *
 * They were stacked full-width, each under a section heading of its own, below
 * two cards that answer the harder questions in six short rows — so the least
 * consequential third of the page took two thirds of its height. An
 * administrator arriving to check a switch scrolled past four hundred words to
 * find it.
 *
 * Side by side and headingless: the pair matches the pair above it, the page
 * reads as four cards in two rows rather than as two cards and an essay, and
 * each card's own title is the heading it already needed. The copy inside them
 * was cut in the same pass — what each control does still gets a line, and
 * what nobody would agree to by accident still gets its sentence.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
export function OrganizationPolicyCard({
  organizationId,
  canManage,
}: {
  organizationId: string;
  /** `organization:manage`: both rules are membership reads and writes. */
  canManage: boolean;
}) {
  const joinRequests = useJoinRequests({ organizationId, canManage });
  const twoStep = useTwoStepRequirement({ organizationId, canManage });

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
    </SimpleGrid>
  );
}
