import type { MemberType } from "@langwatch/enterprise-licensing-contract";
import { nowInstant } from "@langwatch/time";
import type { Dispatch, SetStateAction } from "react";

import { billingApi } from "../../behavior/billing-api.ts";
import { useBillingHost } from "../../model/billing-host.ts";
import { OrganizationUserRole, TeamUserRole } from "../../model/prisma-types.ts";
import type { DrawerSaveResult, PlannedUser } from "../../model/subscription-types.ts";

const FULL_MEMBER: MemberType = "FullMember";

/**
 * What saving the seat drawer does: a paid plan invites into seats it already pays for
 * at once; a free or license plan carries the addresses into the planned upgrade.
 */
export function useDrawerSave({
  invitesIntoPaidSeats,
  organizationId,
  activeTeamId,
  setPlannedUsers,
  setDeletedSeatCount,
  onInvitesSent,
}: {
  invitesIntoPaidSeats: boolean;
  organizationId: string | undefined;
  activeTeamId: string | undefined;
  setPlannedUsers: Dispatch<SetStateAction<PlannedUser[]>>;
  setDeletedSeatCount: Dispatch<SetStateAction<number>>;
  onInvitesSent: () => void;
}) {
  const host = useBillingHost();
  const createInvitesMutation = billingApi.invite.createInvites.useMutation();

  const sendInvites = (organization: string, emails: string[]) =>
    createInvitesMutation.mutate(
      {
        organizationId: organization,
        invites: emails.map((email) => ({
          email: email.toLowerCase(),
          role: OrganizationUserRole.MEMBER,
          ...(activeTeamId ? { teams: [{ teamId: activeTeamId, role: TeamUserRole.MEMBER }] } : {}),
        })),
      },
      {
        onSuccess: () => {
          host.succeeded({ title: "Invites sent successfully" });
          onInvitesSent();
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't send invites" }),
      },
    );

  return (result: DrawerSaveResult) => {
    setPlannedUsers(result.newSeats);
    setDeletedSeatCount(result.deletedSeatCount);
    if (result.inviteEmails.length === 0) return;

    if (invitesIntoPaidSeats) {
      if (organizationId) sendInvites(organizationId, result.inviteEmails);
      return;
    }
    const inviteAsPlanned: PlannedUser[] = result.inviteEmails.map((email, i) => ({
      id: `invite-${nowInstant().epochMilliseconds}-${i}`,
      email,
      memberType: FULL_MEMBER,
    }));
    setPlannedUsers((prev) => [...prev, ...inviteAsPlanned]);
  };
}
