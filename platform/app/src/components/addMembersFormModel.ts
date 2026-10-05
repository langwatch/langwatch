import { OrganizationUserRole } from "~/generated/prisma/client";
import {
  getAutoCorrectedTeamRoleForOrganizationRole,
  type TeamRoleValue,
} from "~/utils/memberRoleConstraints";

/**
 * The shapes and pure rules behind the invite form: what it holds, how it
 * reads the email box, and how a seat reshapes the team rows. Kept free of
 * React so the components stay about layout.
 */

export type TeamOption = { label: string; value: string; description?: string };

/**
 * The seats this form hands out. Admin is not among them, as it never was:
 * the form used to offer Member with a Lite tick-box, and an Admin seat is
 * given from the members list to somebody already in.
 */
export const INVITE_SEATS: readonly OrganizationUserRole[] = [
  OrganizationUserRole.MEMBER,
  OrganizationUserRole.EXTERNAL,
  OrganizationUserRole.DEVELOPER,
];

export type TeamAssignment = {
  teamId: string;
  role: TeamRoleValue;
  customRoleId?: string;
};

export type InviteData = {
  email: string;
  orgRole: OrganizationUserRole;
  teams: TeamAssignment[];
};

// Internal form shape — flattened: one email input, shared role + teams
export type InviteFormValues = {
  emailsRaw: string;
  orgRole: OrganizationUserRole;
  teams: TeamAssignment[];
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function splitInviteEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
}

/** The email box's validation: true, or the message to show under it. */
export function validateInviteEmails(raw: string): true | string {
  const emails = splitInviteEmails(raw);
  if (emails.length === 0) return "At least one email is required";
  const invalid = emails.find((e) => !EMAIL_PATTERN.test(e));
  if (invalid) return `Invalid email: ${invalid}`;
  return true;
}

/** The teams still free for a row, leaving out those other rows already hold. */
export function availableTeamOptions({
  teamOptions,
  selectedTeams,
  exceptIndex,
}: {
  teamOptions: TeamOption[];
  selectedTeams: Array<TeamAssignment | undefined> | undefined;
  exceptIndex?: number;
}): TeamOption[] {
  const taken = new Set(
    (selectedTeams ?? [])
      .filter((_, idx) => idx !== exceptIndex)
      .map((team) => team?.teamId)
      .filter((id): id is string => !!id),
  );
  return teamOptions.filter((opt) => !taken.has(opt.value));
}

export type TeamRoleCorrection = {
  index: number;
  role: TeamRoleValue;
  clearCustomRole: boolean;
};

/**
 * The team rows a seat change must rewrite, and to what. A Lite Member seat
 * holds Viewer only, never a custom role, so its corrections also clear the
 * custom role.
 */
export function teamRoleCorrectionsForSeat({
  teams,
  seat,
}: {
  teams: Array<TeamAssignment | undefined>;
  seat: OrganizationUserRole;
}): TeamRoleCorrection[] {
  return teams.flatMap((team, index) => {
    if (!team) return [];
    const role = getAutoCorrectedTeamRoleForOrganizationRole({
      organizationRole: seat,
      currentTeamRole: team.role,
    });
    if (role === team.role) return [];
    return [
      { index, role, clearCustomRole: seat === OrganizationUserRole.EXTERNAL },
    ];
  });
}

/**
 * A staged row as the seat allows it. A changed role drops any custom role,
 * and a Lite Member seat never carries one.
 */
function teamForSeat(
  team: TeamAssignment,
  seat: OrganizationUserRole,
): TeamAssignment {
  const role = getAutoCorrectedTeamRoleForOrganizationRole({
    organizationRole: seat,
    currentTeamRole: team.role,
  });
  if (role === team.role && seat !== OrganizationUserRole.EXTERNAL) {
    return team;
  }
  return { ...team, role, customRoleId: undefined };
}

/**
 * One invite per email, each carrying the seat and the teams normalised to
 * what the seat allows. A Developer seat (ADR-143) is invited onto no team,
 * whatever the form still holds.
 */
export function invitesFromForm(values: InviteFormValues): InviteData[] {
  const teams =
    values.orgRole === OrganizationUserRole.DEVELOPER
      ? []
      : values.teams.map((team) => teamForSeat(team, values.orgRole));
  return splitInviteEmails(values.emailsRaw).map((email) => ({
    email,
    orgRole: values.orgRole,
    teams,
  }));
}
