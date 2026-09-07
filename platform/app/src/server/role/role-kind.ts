/**
 * The two kinds of `CustomRole` row, as a framework-free contract.
 *
 * `custom` is a role an administrator created and can assign. `system_api_key`
 * is the private permission set minted for one API key, which is never
 * assignable to a user or a group and is only ever carried by that key's own
 * bindings.
 *
 * It lives on its own so the permission resolver, the API-key service and the
 * role repository can all agree on the vocabulary without the resolver having
 * to reach into a storage module for it.
 */
export const CUSTOM_ROLE_KIND = {
  CUSTOM: "custom",
  SYSTEM_API_KEY: "system_api_key",
} as const;

export type CustomRoleKind =
  (typeof CUSTOM_ROLE_KIND)[keyof typeof CUSTOM_ROLE_KIND];
