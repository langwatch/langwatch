import { useEffect, useRef } from "react";
import type { UseFormSetValue } from "react-hook-form";

import {
  type InviteFormValues,
  teamRoleCorrectionsForSeat,
} from "../model/add-members-form-model.ts";
import type { TeamAssignment } from "../model/member-invite-form.ts";
import { OrganizationUserRole } from "../model/prisma-types.ts";

/**
 * Keeps the staged team rows inside what the picked seat allows when the seat
 * changes. A Developer seat (ADR-171) joins no team, so its rows are cleared.
 */
export function useTeamsFollowSeat({
  orgRole,
  selectedTeams,
  setValue,
}: {
  orgRole: OrganizationUserRole;
  selectedTeams: (TeamAssignment | undefined)[] | undefined;
  setValue: UseFormSetValue<InviteFormValues>;
}): void {
  const prevOrgRoleRef = useRef<OrganizationUserRole>(orgRole);

  useEffect(() => {
    const seatChanged = prevOrgRoleRef.current !== orgRole;
    prevOrgRoleRef.current = orgRole;
    if (!seatChanged || !selectedTeams?.length) return;

    if (orgRole === OrganizationUserRole.DEVELOPER) {
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
