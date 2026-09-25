/**
 * Who can join and how accounts stay secure, beside the sign-in cards and
 * independent of the SSO connection lifecycle. Each rule is its own card in
 * one two-column grid. Spec: specs/identity/org-access-cluster.feature
 */
import { SimpleGrid } from "@chakra-ui/react";

import { useJoinRequests } from "../../../../behavior/use-join-requests.ts";
import { useTwoStepRequirement } from "../../../../behavior/use-two-step-requirement.ts";
import type { OrganizationHostApi } from "../../../../model/organization-host.ts";
import { useSignInSecurity } from "../../behavior/use-sign-in-security.ts";
import { DomainJoinCard } from "../blocks/domain-join-card.tsx";
import { SessionLimitCard, SignInLockoutCard } from "../blocks/sign-in-security-cards.tsx";
import { TwoStepRequirementCard } from "../blocks/two-step-requirement-card.tsx";

export function OrganizationPolicyCard({
  host,
  organizationId,
  canManage,
}: {
  host: OrganizationHostApi;
  organizationId: string;
  /** `organization:manage`: every rule here is a membership or security setting. */
  canManage: boolean;
}) {
  const joinRequests = useJoinRequests({ organizationId, canManage });
  const twoStep = useTwoStepRequirement({ organizationId, canManage });
  const signInSecurity = useSignInSecurity({ host, organizationId });

  if (!canManage) return null;

  return (
    <SimpleGrid
      columns={{ base: 1, lg: 2 }}
      gap={4}
      width="full"
      alignItems="start"
      data-testid="organization-policy"
    >
      <DomainJoinCard
        key={`${joinRequests.joining.domainJoin}:${joinRequests.joining.joinDomains.join(",")}`}
        domainJoin={joinRequests.joining.domainJoin}
        joinDomains={joinRequests.joining.joinDomains}
        saving={joinRequests.savingJoining}
        onSave={joinRequests.setJoining}
      />
      {twoStep.show && (
        <TwoStepRequirementCard
          mfaRequired={twoStep.mfaRequired}
          heldCount={twoStep.heldCount}
          memberCount={twoStep.members.length}
          connection={twoStep.connection}
          canTurnOn={twoStep.canTurnOn}
          planLocked={twoStep.planLocked}
          planLink={twoStep.planLink}
          saving={twoStep.saving}
          onChange={twoStep.setRequirement}
        />
      )}
      {signInSecurity.show && (
        <>
          <SignInLockoutCard
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
