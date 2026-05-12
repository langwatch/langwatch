import { TeamUserRole } from "@prisma/client";

/**
 * Role hierarchy from least to most permissive.
 * CUSTOM is not ranked in this hierarchy.
 */
const ROLE_HIERARCHY: readonly TeamUserRole[] = [
  TeamUserRole.VIEWER,
  TeamUserRole.MEMBER,
  TeamUserRole.ADMIN,
] as const;

/**
 * Given an array of {@link TeamUserRole} values from different SCIM group mappings,
 * returns the most permissive role.
 *
 * Hierarchy: ADMIN > MEMBER > VIEWER.
 *
 * CUSTOM is not ranked — if present alongside built-in roles, the built-in
 * hierarchy wins. If only CUSTOM roles are present, returns CUSTOM.
 *
 * @throws {Error} if the roles array is empty.
 */
export function resolveHighestRole(roles: TeamUserRole[]): TeamUserRole {
  if (roles.length === 0) {
    throw new Error("Cannot resolve highest role from an empty array");
  }

  const builtInRoles = roles.filter((r) => r !== TeamUserRole.CUSTOM);

  if (builtInRoles.length === 0) {
    return TeamUserRole.CUSTOM;
  }

  let highest = builtInRoles[0]!;
  let highestIndex = ROLE_HIERARCHY.indexOf(highest);

  for (let i = 1; i < builtInRoles.length; i++) {
    const idx = ROLE_HIERARCHY.indexOf(builtInRoles[i]!);
    if (idx > highestIndex) {
      highest = builtInRoles[i]!;
      highestIndex = idx;
    }
  }

  return highest;
}
