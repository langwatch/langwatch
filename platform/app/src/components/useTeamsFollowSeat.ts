import { useEffect, useRef } from "react";
import type { UseFormSetValue } from "react-hook-form";
import { OrganizationUserRole } from "~/generated/prisma/client";
import {
  type InviteFormValues,
  type TeamAssignment,
  teamRoleCorrectionsForSeat,
} from "./addMembersFormModel";

/**
 * Keeps the staged team rows inside what the picked seat allows, each time
 * the seat changes. A Developer seat (ADR-143) is invited onto no team, so
 * its rows are cleared; the other seats rewrite only the rows whose role
 * the seat does not allow.
 */
export function useTeamsFollowSeat({
  orgRole,
  selectedTeams,
  setValue,
}: {
  orgRole: OrganizationUserRole;
  selectedTeams: Array<TeamAssignment | undefined> | undefined;
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
