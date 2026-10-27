import { vi } from "vitest";

import { AuthzManagedGrantRepository } from "../../authz-managed-grant.repository.ts";

export class StubAuthzManagedGrantRepository extends AuthzManagedGrantRepository {
  readonly hasBindingsForUser = vi.fn<AuthzManagedGrantRepository["hasBindingsForUser"]>(
    async () => false,
  );
  readonly hasLegacySharedTeamMembership = vi.fn<
    AuthzManagedGrantRepository["hasLegacySharedTeamMembership"]
  >(async () => false);
  readonly findScopeRows = vi.fn<AuthzManagedGrantRepository["findScopeRows"]>(async () => []);
  readonly findGroupMembers = vi.fn<AuthzManagedGrantRepository["findGroupMembers"]>(
    async () => [],
  );
  readonly findTeamMembers = vi.fn<AuthzManagedGrantRepository["findTeamMembers"]>(async () => []);
  readonly findOrganizationUserIds = vi.fn<AuthzManagedGrantRepository["findOrganizationUserIds"]>(
    async () => [],
  );
  readonly findRoleHolderPrincipals = vi.fn<
    AuthzManagedGrantRepository["findRoleHolderPrincipals"]
  >(async () => []);
  readonly findGrantPrincipals = vi.fn<AuthzManagedGrantRepository["findGrantPrincipals"]>(
    async () => [],
  );
  readonly findUserGroups = vi.fn<AuthzManagedGrantRepository["findUserGroups"]>(async () => []);
  readonly findOrganizationRole = vi.fn<AuthzManagedGrantRepository["findOrganizationRole"]>(
    async () => null,
  );
  readonly isGroupInOrganization = vi.fn<AuthzManagedGrantRepository["isGroupInOrganization"]>(
    async () => false,
  );
  readonly isApiKeyInOrganization = vi.fn<AuthzManagedGrantRepository["isApiKeyInOrganization"]>(
    async () => false,
  );
  readonly findBinding = vi.fn<AuthzManagedGrantRepository["findBinding"]>(async () => null);
  readonly findDirectUserBindings = vi.fn<AuthzManagedGrantRepository["findDirectUserBindings"]>(
    async () => [],
  );
  readonly findAssignableRoles = vi.fn<AuthzManagedGrantRepository["findAssignableRoles"]>(
    async () => [],
  );
}
