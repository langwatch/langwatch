import type {
  AuthzAttachBindingsInput,
  AuthzAttachBindingsOutput,
  AuthzAttachGrantInput,
  AuthzAttachResourceGrantInput,
  AuthzAttachResourceGrantOutput,
  AuthzBindingOutput,
  AuthzChangeBindingRoleInput,
  AuthzChangeBindingRoleOutput,
  AuthzDefineRoleInput,
  AuthzDefineRoleOutput,
  AuthzDeleteRoleInput,
  AuthzDeleteRoleOutput,
  AuthzOffboardMemberInput,
  AuthzOffboardMemberOutput,
  AuthzOffboardInput,
  AuthzOffboardOutput,
  AuthzReplaceGrantInput,
  AuthzRevokeBindingsInput,
  AuthzRevokeBindingsOutput,
  AuthzRevokeBindingsWhereInput,
  AuthzRevokeBindingsWhereOutput,
  AuthzRevokeGrantInput,
  AuthzRevokeResourceGrantsInput,
  AuthzRevokeResourceGrantsOutput,
  AuthzUpdateGrantInput,
} from "./authz.commands";

/** The one portable mutation and offboarding capability for authorization. */
export abstract class AuthzGrantsService {
  abstract attach(args: AuthzAttachGrantInput): Promise<AuthzBindingOutput>;

  abstract update(args: AuthzUpdateGrantInput): Promise<void>;

  abstract revoke(args: AuthzRevokeGrantInput): Promise<void>;

  abstract replace(args: AuthzReplaceGrantInput): Promise<AuthzBindingOutput>;

  abstract offboard(args: AuthzOffboardInput): Promise<AuthzOffboardOutput>;

  /** Lossless compatibility operations for existing application writers.
   * They live on this capability so no public ledger-writer surface escapes. */
  abstract attachBindings(
    args: AuthzAttachBindingsInput,
  ): Promise<AuthzAttachBindingsOutput>;

  abstract attachResourceGrant(
    args: AuthzAttachResourceGrantInput,
  ): Promise<AuthzAttachResourceGrantOutput>;

  abstract revokeResourceGrants(
    args: AuthzRevokeResourceGrantsInput,
  ): Promise<AuthzRevokeResourceGrantsOutput>;

  abstract changeBindingRole(
    args: AuthzChangeBindingRoleInput,
  ): Promise<AuthzChangeBindingRoleOutput>;

  abstract revokeBindings(
    args: AuthzRevokeBindingsInput,
  ): Promise<AuthzRevokeBindingsOutput>;

  abstract revokeBindingsWhere(
    args: AuthzRevokeBindingsWhereInput,
  ): Promise<AuthzRevokeBindingsWhereOutput>;

  abstract offboardMember(
    args: AuthzOffboardMemberInput,
  ): Promise<AuthzOffboardMemberOutput>;

  abstract defineRole(
    args: AuthzDefineRoleInput,
  ): Promise<AuthzDefineRoleOutput>;

  abstract deleteRole(
    args: AuthzDeleteRoleInput,
  ): Promise<AuthzDeleteRoleOutput>;
}
