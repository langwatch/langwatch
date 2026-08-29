import { type Mock, type Mocked, vi } from "vitest";
import type { AuthzReadRepository } from "../../authz-read.repository";

/**
 * Every port method as a mock. Spelled as a mapped type over the interface so
 * the defaults below are CHECKED against it: a method added to
 * AuthzReadRepository with no default here fails typecheck, which a cast on
 * the returned object would have swallowed.
 */
type ReaderStub = { [K in keyof AuthzReadRepository]: Mock };

/**
 * A read repository whose every method resolves empty - no membership, no
 * bindings, no share links, no owner. Every suite in this package starts
 * from that world and overrides only the reads its scenario turns on, so
 * "what this test switched on" is the whole diff from nothing.
 */
export function makeReader(
  overrides: Partial<AuthzReadRepository> = {},
): Mocked<AuthzReadRepository> {
  const base: ReaderStub = {
    tryFindOrganizationMembership: vi.fn().mockResolvedValue(null),
    findUserBindings: vi.fn().mockResolvedValue([]),
    findGroupBindings: vi.fn().mockResolvedValue([]),
    findApiKeyBindings: vi.fn().mockResolvedValue([]),
    tryFindApiKeyOwner: vi.fn().mockResolvedValue(null),
    findLegacyTeamMemberships: vi.fn().mockResolvedValue([]),
    findCustomRolePermissions: vi.fn().mockResolvedValue([]),
    findShareLinks: vi.fn().mockResolvedValue([]),
    tryFindProjectLineage: vi.fn().mockResolvedValue(null),
    tryFindTeamOrganization: vi.fn().mockResolvedValue(null),
  };
  return { ...base, ...overrides } as Mocked<AuthzReadRepository>;
}
