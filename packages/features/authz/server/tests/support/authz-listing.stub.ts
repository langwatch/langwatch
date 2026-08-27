import { vi } from "vitest";
import { AuthzListingRepository } from "../../src/repositories/authz-listing.repository";

/** Empty access read model; tests override only the listing they exercise. */
export class StubAuthzListingRepository extends AuthzListingRepository {
  readonly findUserBindings = vi.fn<AuthzListingRepository["findUserBindings"]>(async () => []);
  readonly findOrganizationBindings = vi.fn<AuthzListingRepository["findOrganizationBindings"]>(
    async () => [],
  );
  readonly findUserAndGroupBindings = vi.fn<AuthzListingRepository["findUserAndGroupBindings"]>(
    async () => [],
  );
  readonly findScopeBindings = vi.fn<AuthzListingRepository["findScopeBindings"]>(async () => []);
  readonly findGroupBindings = vi.fn<AuthzListingRepository["findGroupBindings"]>(async () => []);
  readonly findTeamMemberBindings = vi.fn<AuthzListingRepository["findTeamMemberBindings"]>(
    async () => new Map(),
  );
  readonly findBindingsForSynthesis = vi.fn<AuthzListingRepository["findBindingsForSynthesis"]>(
    async () => [],
  );
  readonly findUserCreatedRoles = vi.fn<AuthzListingRepository["findUserCreatedRoles"]>(
    async () => [],
  );
}
