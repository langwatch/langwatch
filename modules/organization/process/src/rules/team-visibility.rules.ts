/** The organization role that opens every team of the organization. */
const ORGANIZATION_ADMIN_ROLE = "ADMIN";

/**
 * Whether the caller can open a team: an organization administrator, or a
 * member of the team (a membership row or one synthesized from a binding).
 * Main's project selector rule, applied before `organization.getAll` answers.
 */
export function userCanOpenTeam({
  team,
  userId,
  organizationRole,
}: {
  team: { readonly members: readonly { readonly userId: string }[] };
  userId: string;
  organizationRole: string | undefined;
}): boolean {
  if (organizationRole === ORGANIZATION_ADMIN_ROLE) return true;
  return team.members.some((member) => member.userId === userId);
}
