import { useMemo } from "react";

import { billingApi } from "../../behavior/billing-api.ts";
import { classifyMemberType } from "../../model/member-classification.ts";
import { heldSeatsOf, noHeldSeats } from "../../model/seat-purchase.ts";
import type { SubscriptionUser } from "../../model/subscription-types.ts";

/** The organization's members, pending invites and held seats, classified for seat counting. */
export function useSubscriptionMembers({
  organizationId,
  readsHeldSeats,
}: {
  organizationId: string | undefined;
  /** Only `organization:manage` may list held seats; anyone else sees the bare count. */
  readsHeldSeats: boolean;
}) {
  const enabled = !!organizationId;
  const organizationWithMembers =
    billingApi.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      { organizationId: organizationId ?? "", includeDeactivated: false },
      { enabled },
    );
  const heldSeatsQuery = billingApi.organization.listHeldSeats.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: enabled && readsHeldSeats },
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

  const heldSeats = useMemo(() => {
    if (!readsHeldSeats || !heldSeatsQuery.data) return noHeldSeats;
    const full = <T extends { memberType: string }>(list: T[]) =>
      list.filter((entry) => entry.memberType === "FullMember");
    return heldSeatsOf({
      holds: heldSeatsQuery.data.heldSeats,
      fullMemberIds: new Set(full(users).map((user) => user.userId)),
      fullInviteEmails: new Set(
        full(pendingInvitesWithMemberType).map((i) => i.email.toLowerCase()),
      ),
    });
  }, [readsHeldSeats, heldSeatsQuery.data, users, pendingInvitesWithMemberType]);

  return {
    organizationWithMembers,
    pendingInvites,
    users,
    pendingInvitesWithMemberType,
    heldSeats,
  };
}
