import type {
  AuthzApplyMemberBindingsInput,
  AuthzBindingMutationSuccess,
  AuthzCreateBindingInput,
  AuthzCreateBindingOutput,
  AuthzDeleteBindingInput,
  AuthzUpdateBindingInput,
} from "./authz.binding-management.ts";
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
  AuthzRetireDirectoryGrantsInput,
  AuthzRetireDirectoryGrantsOutput,
  AuthzRevokeBindingsWhereOutput,
  AuthzRevokeGrantInput,
  AuthzRevokeResourceGrantsInput,
  AuthzRevokeResourceGrantsOutput,
  AuthzUpdateGrantInput,
} from "./authz.commands.ts";

/** The one portable mutation and offboarding capability for authorization. */
export abstract class AuthzGrantsService {
  abstract attach(args: AuthzAttachGrantInput): Promise<AuthzBindingOutput>;

  abstract update(args: AuthzUpdateGrantInput): Promise<void>;

  abstract revoke(args: AuthzRevokeGrantInput): Promise<void>;

  abstract replace(args: AuthzReplaceGrantInput): Promise<AuthzBindingOutput>;

  abstract offboard(args: AuthzOffboardInput): Promise<AuthzOffboardOutput>;

  /**
   * Retire every cached authorization snapshot for one organization. Grant
   * writes do this themselves; this is for writes that change who may do
   * what WITHOUT touching a grant, like a membership being disabled.
   */
  abstract invalidateOrganization(args: { organizationId: string }): Promise<void>;

  /** Lossless compatibility operations for existing application writers.
   * They live on this capability so no public ledger-writer surface escapes. */
  abstract attachBindings(args: AuthzAttachBindingsInput): Promise<AuthzAttachBindingsOutput>;

  abstract attachResourceGrant(
    args: AuthzAttachResourceGrantInput,
  ): Promise<AuthzAttachResourceGrantOutput>;

  abstract revokeResourceGrants(
    args: AuthzRevokeResourceGrantsInput,
  ): Promise<AuthzRevokeResourceGrantsOutput>;

  abstract changeBindingRole(
    args: AuthzChangeBindingRoleInput,
  ): Promise<AuthzChangeBindingRoleOutput>;

  abstract revokeBindings(args: AuthzRevokeBindingsInput): Promise<AuthzRevokeBindingsOutput>;

  abstract revokeBindingsWhere(
    args: AuthzRevokeBindingsWhereInput,
  ): Promise<AuthzRevokeBindingsWhereOutput>;

  abstract retireDirectoryGrants(
    args: AuthzRetireDirectoryGrantsInput,
  ): Promise<AuthzRetireDirectoryGrantsOutput>;

  abstract offboardMember(args: AuthzOffboardMemberInput): Promise<AuthzOffboardMemberOutput>;

  abstract defineRole(args: AuthzDefineRoleInput): Promise<AuthzDefineRoleOutput>;

  abstract deleteRole(args: AuthzDeleteRoleInput): Promise<AuthzDeleteRoleOutput>;

  abstract createBinding(args: AuthzCreateBindingInput): Promise<AuthzCreateBindingOutput>;

  abstract updateBinding(args: AuthzUpdateBindingInput): Promise<AuthzCreateBindingOutput>;

  abstract deleteBinding(args: AuthzDeleteBindingInput): Promise<AuthzBindingMutationSuccess>;

  abstract applyMemberBindings(
    args: AuthzApplyMemberBindingsInput,
  ): Promise<AuthzBindingMutationSuccess>;
}
