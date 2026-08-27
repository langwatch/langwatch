import { vi } from "vitest";
import { AuthzBindingRepository } from "../../src/repositories/authz-binding.repository";

export class StubAuthzBindingRepository extends AuthzBindingRepository {
  readonly hasBindingsForUser = vi.fn<AuthzBindingRepository["hasBindingsForUser"]>(
    async () => false,
  );
  readonly hasLegacySharedTeamMembership = vi.fn<
    AuthzBindingRepository["hasLegacySharedTeamMembership"]
  >(async () => false);
  readonly findScopeRows = vi.fn<AuthzBindingRepository["findScopeRows"]>(async () => []);
  readonly findGroupMembers = vi.fn<AuthzBindingRepository["findGroupMembers"]>(async () => []);
  readonly findUserGroups = vi.fn<AuthzBindingRepository["findUserGroups"]>(async () => []);
  readonly tryFindOrganizationRole = vi.fn<AuthzBindingRepository["tryFindOrganizationRole"]>(
    async () => null,
  );
  readonly isGroupInOrganization = vi.fn<AuthzBindingRepository["isGroupInOrganization"]>(
    async () => false,
  );
  readonly isApiKeyInOrganization = vi.fn<AuthzBindingRepository["isApiKeyInOrganization"]>(
    async () => false,
  );
  readonly tryFindBinding = vi.fn<AuthzBindingRepository["tryFindBinding"]>(async () => null);
  readonly findDirectUserBindings = vi.fn<AuthzBindingRepository["findDirectUserBindings"]>(
    async () => [],
  );
  readonly findAssignableRoles = vi.fn<AuthzBindingRepository["findAssignableRoles"]>(
    async () => [],
  );
}
