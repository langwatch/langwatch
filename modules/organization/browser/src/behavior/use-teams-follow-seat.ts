import { useEffect, useRef } from "react";
import type { UseFormSetValue } from "react-hook-form";

import {
  type InviteFormValues,
  seatJoinsNoTeam,
  teamRoleCorrectionsForSeat,
} from "../model/add-members-form-model.ts";
import type { InviteSeat, TeamAssignment } from "../model/member-invite-form.ts";

/**
 * Keeps the staged team rows inside what the picked seat allows when the seat
 * changes. A Developer seat (ADR-171) and Billing only (ADR-205) join no team, so their rows
 * are cleared.
 */
export function useTeamsFollowSeat({
  orgRole,
  selectedTeams,
  setValue,
}: {
  orgRole: InviteSeat;
  selectedTeams: (TeamAssignment | undefined)[] | undefined;
  setValue: UseFormSetValue<InviteFormValues>;
}): void {
  const prevOrgRoleRef = useRef<InviteSeat>(orgRole);

  useEffect(() => {
    const seatChanged = prevOrgRoleRef.current !== orgRole;
    prevOrgRoleRef.current = orgRole;
    if (!seatChanged || !selectedTeams?.length) return;

    if (seatJoinsNoTeam(orgRole)) {
      setValue("teams", []);
      return;
    }
    const corrections = teamRoleCorrectionsForSeat({
      teams: selectedTeams,
      seat: orgRole,
    });
    for (const { index, role, clearCustomRole } of corrections) {
      setValue(`teams.${index}.role`, role);
      if (clearCustomRole) setValue(`teams.${index}.customRoleId`, undefined);
    }
  }, [orgRole, selectedTeams, setValue]);
}
