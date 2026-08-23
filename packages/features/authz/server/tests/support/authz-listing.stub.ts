import { vi } from "vitest";
import { AuthzListingRepository } from "../../src/repositories/authz-listing.repository";

/** Empty access read model; tests override only the listing they exercise. */
export class StubAuthzListingRepository extends AuthzListingRepository {
  readonly findUserBindings = vi.fn(async () => []);
  readonly findOrganizationBindings = vi.fn(async () => []);
  readonly findUserAndGroupBindings = vi.fn(async () => []);
  readonly findScopeBindings = vi.fn(async () => []);
  readonly findGroupBindings = vi.fn(async () => []);
  readonly findTeamMemberBindings = vi.fn(async () => new Map());
  readonly findBindingsForSynthesis = vi.fn(async () => []);
  readonly findUserCreatedRoles = vi.fn(async () => []);
}
