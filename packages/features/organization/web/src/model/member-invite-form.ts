import type { OrganizationUserRole } from "./prisma-types";
import type { TeamRoleValue } from "./member-role-constraints";

/**
 * What one invitation is, before anything renders it.
 *
 * The shape lives here rather than beside the form because the mutation that
 * sends it is behavior and the form is a block: a block may read the model and
 * behavior may read the model, but neither may read the other.
 */
export type TeamAssignment = {
  teamId: string;
  role: TeamRoleValue;
  customRoleId?: string | null;
};

export type InviteData = {
  email: string;
  orgRole: OrganizationUserRole;
  teams: TeamAssignment[];
};

export type MembersForm = {
  invites: InviteData[];
};
