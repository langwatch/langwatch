import { useUiDeployment } from "@langwatch/browser-host/capabilities";
import type { OrganizationMemberFactor } from "@langwatch/identity-contract";
import { useCallback, useMemo } from "react";

import { useOrganizationHost } from "../model/organization-host.ts";
import { twoStepVerificationApi } from "./two-step-verification-api.ts";

const NO_MEMBERS: readonly OrganizationMemberFactor[] = [];
const NO_CONNECTION = { connected: false, assertedFactors: [], assertsSecondFactor: false };

/**
 * What the organization requires, who can prove a second factor, and the one
 * write that changes it: state and callbacks, never JSX. Refusals reach the
 * administrator as registry words. Spec: specs/identity/mfa-and-session-shape.feature
 */
export function useTwoStepRequirement({
  organizationId,
  canManage,
}: {
  organizationId: string;
  canManage: boolean;
}) {
  const host = useOrganizationHost();
  const { isSaaS } = useUiDeployment();
  const utils = twoStepVerificationApi.useUtils();
  const requirement = twoStepVerificationApi.twoStepVerification.requirement.useQuery(
    { organizationId },
    { enabled: canManage && !!organizationId },
  );
  const offered = canManage && requirement.data?.offered === true;
  const members = twoStepVerificationApi.twoStepVerification.memberFactors.useQuery(
    { organizationId },
    { enabled: offered },
  );
  const setRequirementMutation =
    twoStepVerificationApi.twoStepVerification.setRequirement.useMutation();

  const setRequirement = useCallback(
    (mfaRequired: boolean) => {
      setRequirementMutation.mutate(
        { organizationId, mfaRequired },
        {
          onSuccess: () => {
            host.succeeded({
              title: "Saved",
              description: mfaRequired
                ? "Members who cannot prove a second factor will be asked to set one up before they can reach this organization. Nobody has been signed out."
                : "Members are no longer asked for a second factor here. Anybody who set one up keeps it.",
            });
            void utils.twoStepVerification.requirement.invalidate();
            void utils.twoStepVerification.memberFactors.invalidate();
          },
          onError: (error) => host.failed({ error, fallbackTitle: "Couldn't save that setting" }),
        },
      );
    },
    [host, organizationId, setRequirementMutation, utils],
  );

  const memberList = members.data ?? NO_MEMBERS;
  const byUser = useMemo(
    () => new Map(memberList.map((member) => [member.userId, member])),
    [memberList],
  );

  return {
    /** Whether the card and the column belong on the page at all. */
    show: offered,
    mfaRequired: requirement.data?.mfaRequired ?? false,
    connection: requirement.data?.connection ?? NO_CONNECTION,
    members: memberList,
    byUser,
    /** How many members the requirement is holding, or would hold. */
    heldCount: memberList.filter((member) => !member.satisfaction.satisfied).length,
    /** Turning it on needs the Enterprise plan; turning it off never does. */
    canTurnOn: host.isEnterprise(),
    planLocked: !host.isEnterprise() && !host.isPlanLoading(),
    /** Where the lock points: the plans on Cloud, the licence when self-hosted. */
    planLink: isSaaS
      ? { href: "/settings/subscription", label: "See plans" }
      : { href: "/settings/license", label: "Activate a license" },
    saving: setRequirementMutation.isPending,
    setRequirement,
  };
}
