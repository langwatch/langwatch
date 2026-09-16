import type { OrganizationUserRole } from "./prisma-types.ts";
import type { TeamRoleValue } from "./member-role-constraints.ts";

/**
 * What one invitation is, before anything renders it. Lives here rather
 * than beside the form since the sending mutation is behavior and the form
 * is a block — both may read the model, but neither may read the other.
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
