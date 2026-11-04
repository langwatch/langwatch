import {
  computePermissionsFromSelections,
  isNeverOnCliKey,
  type AccessLevel,
} from "@langwatch/api-key-contract";

/**
 * The CLI login key's permissions: untouched, the defaults held; customised, the
 * selections. Never one a CLI key may not carry: a category's "Write" expands to every
 * action on it, so Organization at Write would otherwise bring `organization:delete`.
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
    ? computePermissionsFromSelections(selections)
    : defaultPermissionsHeld;
  return permissions.filter((permission) => !isNeverOnCliKey(permission));
}
