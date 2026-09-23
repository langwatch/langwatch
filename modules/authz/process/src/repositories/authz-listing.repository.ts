import type {
  AuthzAccessBinding,
  AuthzBindingForSynthesis,
  AuthzCustomRole,
  AuthzListApiKeyBindingsInput,
  AuthzListBindingsForSynthesisInput,
  AuthzListGroupBindingsInput,
  AuthzListOrganizationBindingsInput,
  AuthzListScopeBindingsInput,
  AuthzListTeamMemberBindingsInput,
  AuthzListUserAndGroupBindingsInput,
  AuthzListUserBindingsInput,
  AuthzTeamMemberBinding,
} from "@langwatch/authz-contract";

/** Private access-listing read model consumed only through AuthzService. */
export abstract class AuthzListingRepository {
  // Every member below is a property of function type rather than method
  // shorthand: tests hold a mock built to this class and assert on these
  // members via `expect(...).toHaveBeenCalledWith`/`.toHaveBeenCalledTimes`,
  // which is unsafe against a method-shorthand member under `unbound-method`.
  abstract findUserBindings: (input: AuthzListUserBindingsInput) => Promise<AuthzAccessBinding[]>;

  abstract findOrganizationBindings: (
    input: AuthzListOrganizationBindingsInput,
  ) => Promise<AuthzAccessBinding[]>;

  abstract findUserAndGroupBindings: (
    input: AuthzListUserAndGroupBindingsInput,
  ) => Promise<AuthzAccessBinding[]>;

  abstract findScopeBindings: (input: AuthzListScopeBindingsInput) => Promise<AuthzAccessBinding[]>;

  abstract findGroupBindings: (input: AuthzListGroupBindingsInput) => Promise<AuthzAccessBinding[]>;

  abstract findApiKeyBindings: (
    input: AuthzListApiKeyBindingsInput,
  ) => Promise<AuthzAccessBinding[]>;

  abstract findTeamMemberBindings: (
    input: AuthzListTeamMemberBindingsInput,
  ) => Promise<Map<string, AuthzTeamMemberBinding[]>>;

  abstract findBindingsForSynthesis: (
    input: AuthzListBindingsForSynthesisInput,
  ) => Promise<AuthzBindingForSynthesis[]>;

  abstract findUserCreatedRoles: (input: { organizationId: string }) => Promise<AuthzCustomRole[]>;
}
