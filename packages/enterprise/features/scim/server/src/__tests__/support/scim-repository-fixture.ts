// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { vi } from "vitest";
import type { ScimRepositoryPort } from "../../ports/scim-repository.port";

/**
 * A complete `ScimRepositoryPort`, answering nothing.
 *
 * `ScimService` reaches nineteen of the port's members across tokens,
 * memberships, groups and directory identities, so a test that builds one is
 * building all of it — which is why the ones that did not resorted to casting a
 * handful of methods at the whole port. Every stub here answers the empty case;
 * a test states only what it needs differently.
 *
 * The narrow group-half type belongs to `ScimDirectoryService`
 * (`ScimDirectoryRepository`) and is what a group-only test should declare
 * instead of reaching for this.
 */
export function scimRepositoryFixture(
  overrides: Partial<ScimRepositoryPort> = {},
): ScimRepositoryPort {
  return {
    tryFindOrganizationBySsoDomain: vi.fn(async () => null),
    createToken: vi.fn(async () => ({ id: "token-1" })),
    listTokens: vi.fn(async () => []),
    tryFindToken: vi.fn(async () => null),
    revokeToken: vi.fn(async () => false),
    revokeTokensForConnection: vi.fn(async () => 0),
    tryFindTokenByHash: vi.fn(async () => null),
    recordTokenUse: vi.fn(async () => undefined),
    tryFindMembership: vi.fn(async () => null),
    listMemberships: vi.fn(async () => ({ rows: [], total: 0 })),
    addMembership: vi.fn(async () => undefined),
    removeMembership: vi.fn(async () => undefined),
    tryFindGroup: vi.fn(async () => null),
    listGroups: vi.fn(async () => ({ rows: [], total: 0 })),
    createGroup: vi.fn(),
    renameGroup: vi.fn(async () => undefined),
    deleteGroup: vi.fn(async () => undefined),
    listGroupMembers: vi.fn(async () => []),
    listGroupMemberIds: vi.fn(async () => []),
    addGroupMember: vi.fn(async () => undefined),
    removeGroupMembers: vi.fn(async () => undefined),
    groupSlugExists: vi.fn(async () => false),
    listRoleBindings: vi.fn(async () => []),
    scimConnectionExists: vi.fn(async () => true),
    tryFindDirectoryUserId: vi.fn(async () => null),
    rememberDirectoryIdentity: vi.fn(async () => undefined),
    forgetDirectoryIdentity: vi.fn(async () => undefined),
    forgetDirectoryIdentitiesForUser: vi.fn(async () => undefined),
    listDirectoryConnectionsForUser: vi.fn(async () => []),
    ...overrides,
  };
}
