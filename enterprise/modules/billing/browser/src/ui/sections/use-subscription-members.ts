import { useMemo } from "react";

import { billingApi } from "../../behavior/billing-api.ts";
import { classifyMemberType } from "../../model/member-classification.ts";
import { heldSeatsOf, noHeldSeats } from "../../model/seat-purchase.ts";
import type { SubscriptionUser } from "../../model/subscription-types.ts";

/** The organization's members, pending invites and held seats, classified for seat counting. */
export function useSubscriptionMembers(organizationId: string | undefined) {
  const enabled = !!organizationId;
  const organizationWithMembers =
    billingApi.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      { organizationId: organizationId ?? "", includeDeactivated: false },
      { enabled },
    );
  const heldSeatsQuery = billingApi.organization.listHeldSeats.useQuery(
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
        // An expired invite holds no seat: enforcement does not count it, so
        // neither does the seat count nor the checkout.
        .filter((inv) => inv.displayStatus === "PENDING")
        .map((inv) => ({
          id: inv.id,
          email: inv.email,
          memberType: classifyMemberType(inv.role, undefined),
        })),
    [pendingInvites.data],
  );

  const heldSeats = useMemo(
    () => (heldSeatsQuery.data ? heldSeatsOf(heldSeatsQuery.data.heldSeats) : noHeldSeats),
    [heldSeatsQuery.data],
  );

  return {
    organizationWithMembers,
    pendingInvites,
    users,
    pendingInvitesWithMemberType,
    heldSeats,
  };
}
