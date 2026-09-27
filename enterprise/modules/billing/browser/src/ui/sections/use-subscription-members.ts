import { useMemo } from "react";

import { billingApi } from "../../behavior/billing-api.ts";
import { classifyMemberType } from "../../model/member-classification.ts";
import type { SubscriptionUser } from "../../model/subscription-types.ts";

/** The organization's members and pending invites, classified for seat counting. */
export function useSubscriptionMembers(organizationId: string | undefined) {
  const enabled = !!organizationId;
  const organizationWithMembers =
    billingApi.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      { organizationId: organizationId ?? "" },
      { enabled },
    );
  const pendingInvites = billingApi.invite.getOrganizationPendingInvites.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled },
  );

  const users: SubscriptionUser[] = useMemo(
    () =>
      (organizationWithMembers.data?.members ?? []).map((member) => ({
        id: member.userId,
        userId: member.userId,
        name: member.user.name ?? "",
        email: member.user.email ?? "",
        role: member.role,
        // Simplified classification (EXTERNAL = LiteMember); custom-role permissions unread.
        memberType: classifyMemberType(member.role, undefined),
      })),
    [organizationWithMembers.data],
  );

  const pendingInvitesWithMemberType = useMemo(
    () =>
      (pendingInvites.data ?? [])
        .filter((inv) => inv.status === "PENDING")
        .map((inv) => ({
          id: inv.id,
          email: inv.email,
          memberType: classifyMemberType(inv.role, undefined),
        })),
    [pendingInvites.data],
  );

  return { organizationWithMembers, pendingInvites, users, pendingInvitesWithMemberType };
}
