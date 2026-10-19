/** The grant wire names a role by id: a built-in's lowercase name, or the custom role's id. */
export function grantRoleId({
  role,
  customRoleId,
}: {
  role: string;
  customRoleId?: string | null;
}): string {
  return customRoleId ?? role.toLowerCase();
}
