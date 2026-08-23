import type {
  AuthzAccessBinding,
  AuthzBindingForSynthesis,
  AuthzCustomRole,
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
  abstract findUserBindings(
    input: AuthzListUserBindingsInput,
  ): Promise<AuthzAccessBinding[]>;

  abstract findOrganizationBindings(
    input: AuthzListOrganizationBindingsInput,
  ): Promise<AuthzAccessBinding[]>;

  abstract findUserAndGroupBindings(
    input: AuthzListUserAndGroupBindingsInput,
  ): Promise<AuthzAccessBinding[]>;

  abstract findScopeBindings(
    input: AuthzListScopeBindingsInput,
  ): Promise<AuthzAccessBinding[]>;

  abstract findGroupBindings(
    input: AuthzListGroupBindingsInput,
  ): Promise<AuthzAccessBinding[]>;

  abstract findTeamMemberBindings(
    input: AuthzListTeamMemberBindingsInput,
  ): Promise<Map<string, AuthzTeamMemberBinding[]>>;

  abstract findBindingsForSynthesis(
    input: AuthzListBindingsForSynthesisInput,
  ): Promise<AuthzBindingForSynthesis[]>;

  abstract findUserCreatedRoles(input: {
    organizationId: string;
  }): Promise<AuthzCustomRole[]>;
}
