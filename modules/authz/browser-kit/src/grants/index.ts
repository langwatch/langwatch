// Grant editing surface: list, dialog, revoke confirmation and the pure model travel together.

export {
  GrantDialog,
  type GrantDialogProps,
  type GrantDraft,
  type GrantScope,
} from "./grant-dialog.tsx";
export { GrantRoleButton, type GrantRoleButtonProps } from "./grant-role-button.tsx";
export { GrantsTable, type GrantsTableProps } from "./grants-table.tsx";
export {
  expiryFromDay,
  grantPrincipalText,
  grantRoleOptions,
  grantScopeText,
  permissionsBeyondReader,
  rolePermissionsAt,
  type GrantRoleOption,
  type GrantRow,
} from "./grants.ts";
export { RevokeGrantDialog, type RevokeGrantDialogProps } from "./revoke-grant-dialog.tsx";
