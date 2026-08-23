import type {
  AuthzAttachBindingsInput,
  AuthzAttachBindingsOutput,
  AuthzAttachResourceGrantInput,
  AuthzChangeBindingRoleInput,
  AuthzDefineRoleInput,
  AuthzDeleteRoleInput,
  AuthzOffboardMemberInput,
  AuthzRevokeBindingsInput,
  AuthzRevokeBindingsWhereInput,
  AuthzRevokeBindingsWhereOutput,
  AuthzRevokeResourceGrantsInput,
} from "@langwatch/authz-contract";

/**
 * Private server-side compatibility seam for callers whose legacy operations
 * cannot yet be expressed by the smaller high-level grant verbs. It remains
 * behind AuthzGrantsService and is never exported from the package root.
 */
export abstract class AuthzCompatibilityLedgerPort {
  abstract attachBindings(
    args: AuthzAttachBindingsInput,
  ): Promise<AuthzAttachBindingsOutput>;

  abstract attachResourceGrant(
    args: AuthzAttachResourceGrantInput,
  ): Promise<void>;

  abstract revokeResourceGrants(
    args: AuthzRevokeResourceGrantsInput,
  ): Promise<void>;

  abstract changeBindingRole(args: AuthzChangeBindingRoleInput): Promise<void>;

  abstract revokeBindings(args: AuthzRevokeBindingsInput): Promise<void>;

  abstract revokeBindingsWhere(
    args: AuthzRevokeBindingsWhereInput,
  ): Promise<AuthzRevokeBindingsWhereOutput>;

  abstract offboardMember(args: AuthzOffboardMemberInput): Promise<void>;

  abstract defineRole(args: AuthzDefineRoleInput): Promise<void>;

  abstract deleteRole(args: AuthzDeleteRoleInput): Promise<void>;
}
