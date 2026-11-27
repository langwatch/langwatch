import type { TeamRoleValue } from "./member-role-constraints.ts";
import type { OrganizationUserRole } from "./prisma-types.ts";

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

/**
 * The invite form's Billing only choice (ADR-205): not a seat, so not an organization role. It is
 * sent as an EXTERNAL invite with `billingOnly` and no team.
 */
export const BILLING_ONLY_SEAT = "BILLING_ONLY" as const;
/** What the invite form's Seat picker holds: a seat, or Billing only. */
export type InviteSeat = OrganizationUserRole | typeof BILLING_ONLY_SEAT;

export type InviteData = {
  email: string;
  orgRole: OrganizationUserRole;
  teams: TeamAssignment[];
  /** The person who pays: the Billing grant, no team, no seat. */
  billingOnly?: boolean;
};

export type MembersForm = {
  invites: InviteData[];
};
