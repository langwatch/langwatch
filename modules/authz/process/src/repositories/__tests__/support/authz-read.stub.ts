import { type Mock, type Mocked, vi } from "vitest";

import type { AuthzReadRepository } from "../../authz-read.repository.ts";

/**
 * Every port method as a mock. Spelled as a mapped type over the interface
 * so the defaults below are CHECKED against it: a method added to
 * AuthzReadRepository with no default here fails typecheck.
 */
type ReaderStub = { [K in keyof AuthzReadRepository]: Mock };

/**
 * A read repository whose every method resolves empty - no membership, no
 * bindings, no share links, no owner. Every suite starts from that world
 * and overrides only the reads its scenario turns on.
 */
export function makeReader(
  overrides: Partial<AuthzReadRepository> = {},
): Mocked<AuthzReadRepository> {
  const base: ReaderStub = {
    findOrganizationMembership: vi.fn().mockResolvedValue(null),
    findUserBindings: vi.fn().mockResolvedValue([]),
    findGroupBindings: vi.fn().mockResolvedValue([]),
    findApiKeyBindings: vi.fn().mockResolvedValue([]),
    findApiKeyOwner: vi.fn().mockResolvedValue(null),
    findCustomRolePermissions: vi.fn().mockResolvedValue([]),
    findShareLinks: vi.fn().mockResolvedValue([]),
    findProjectLineage: vi.fn().mockResolvedValue(null),
    findTeamOrganization: vi.fn().mockResolvedValue(null),
  };
  return { ...base, ...overrides } as Mocked<AuthzReadRepository>;
}
