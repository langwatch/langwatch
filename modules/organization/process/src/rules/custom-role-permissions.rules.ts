/** The custom role ids behind a set of team bindings, bindings without one skipped. */
export function customRoleIdsOf({
  bindings,
}: Readonly<{ bindings: readonly { customRoleId: string | null }[] }>): string[] {
  return bindings.map((binding) => binding.customRoleId).filter((id): id is string => !!id);
}

/**
 * The union of permissions the custom roles grant. Each role's `permissions` is a Json column,
 * so the row decides its shape: anything but an array of strings grants nothing.
 */
export function customRolePermissionsOf({
  permissionsPerRole,
}: Readonly<{ permissionsPerRole: readonly unknown[] }>): string[] {
  return permissionsPerRole.flatMap((permissions) =>
    Array.isArray(permissions)
      ? permissions.filter((permission): permission is string => typeof permission === "string")
      : [],
  );
}
