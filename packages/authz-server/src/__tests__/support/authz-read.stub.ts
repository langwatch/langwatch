import { type Mocked, vi } from "vitest";
import type { AuthzReadRepository } from "../../authz-read.repository";

/**
 * A read repository whose every method resolves empty - no membership, no
 * bindings, no share links, no owner. Every suite in this package starts
 * from that world and overrides only the reads its scenario turns on, so
 * "what this test switched on" is the whole diff from nothing.
 */
export function makeReader(
  overrides: Partial<AuthzReadRepository> = {},
): Mocked<AuthzReadRepository> {
  return {
    findOrganizationRole: vi.fn().mockResolvedValue(null),
    findUserBindings: vi.fn().mockResolvedValue([]),
    findGroupBindings: vi.fn().mockResolvedValue([]),
    findApiKeyBindings: vi.fn().mockResolvedValue([]),
    findApiKeyOwner: vi.fn().mockResolvedValue(null),
    findLegacyTeamMemberships: vi.fn().mockResolvedValue([]),
    findCustomRolePermissions: vi.fn().mockResolvedValue([]),
    findShareLinks: vi.fn().mockResolvedValue([]),
    findProjectLineage: vi.fn().mockResolvedValue(null),
    findTeamOrganization: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as Mocked<AuthzReadRepository>;
}
