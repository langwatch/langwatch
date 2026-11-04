import {
  cliPermissionCategories,
  computePermissionsFromSelections,
  isNeverOnCliKey,
  selectionsFromPermissions,
  type AccessLevel,
} from "@langwatch/api-key-contract";

/**
 * The CLI login key's permissions: untouched, the defaults held; customised, the
 * selections, read through the CLI's categories, where Organization at Write is its
 * management without its deletion. The final filter backs that up: never a permission
 * a CLI key may not carry.
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
 * Where Customize opens: the levels the default permissions held amount to, so opening
 * it and approving unchanged mints the same key. Read through the regular categories, a
 * `--management` default would show Organization at Read (Write there needs
 * `organization:delete`, which no CLI default holds) and drop `organization:manage`.
 */
export const cliSelectionsFromPermissions = (permissions: string[]): Record<string, AccessLevel> =>
  selectionsFromPermissions(permissions, cliPermissionCategories());
