import {
  cliPermissionCategories,
  computePermissionsFromSelections,
  isNeverOnCliKey,
  selectionsFromPermissions,
  type AccessLevel,
} from "@langwatch/api-key-contract";

/**
 * The CLI login key's permissions: the defaults held, or the selections read through the
 * CLI categories (Organization Write = manage, not delete). The filter backs that up.
 */
export function cliKeyPermissions({
  isCustomized,
  selections,
  defaultPermissionsHeld,
}: {
  isCustomized: boolean;
  selections: Record<string, AccessLevel | "none">;
  defaultPermissionsHeld: string[];
}): string[] {
  const permissions = isCustomized
    ? computePermissionsFromSelections(selections, cliPermissionCategories())
    : defaultPermissionsHeld;
  return permissions.filter((permission) => !isNeverOnCliKey(permission));
}

/**
 * Where Customize opens. Through the regular categories a `--management` default reads as
 * Organization Read (Write there needs `organization:delete`) and drops `organization:manage`.
 */
export const cliSelectionsFromPermissions = (permissions: string[]): Record<string, AccessLevel> =>
  selectionsFromPermissions(permissions, cliPermissionCategories());
