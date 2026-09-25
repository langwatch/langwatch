// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { fromDate } from "@langwatch/time";
import { vi } from "vitest";

import type { ScimRepository } from "../../repositories/scim.repository.ts";

/**
 * A complete `ScimRepository`, answering nothing.
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
export function scimRepositoryFixture(overrides: Partial<ScimRepository> = {}): ScimRepository {
  return {
    findOrganizationBySsoDomain: vi.fn(async () => null),
    createToken: vi.fn(async () => ({ id: "token-1" })),
    findTokens: vi.fn(async () => []),
    findToken: vi.fn(async () => null),
    revokeToken: vi.fn(async () => false),
    revokeTokensForConnection: vi.fn(async () => 0),
    findTokenIdsForConnection: vi.fn(async () => []),
    moveDirectoryToConnection: vi.fn(async () => undefined),
    findTokensByHashes: vi.fn(async () => []),
    recordTokenUse: vi.fn(async () => undefined),
    findMembership: vi.fn(async () => null),
    findOrganizationUsers: vi.fn(async () => ({ rows: [], total: 0 })),
    recordRequest: vi.fn(async () => undefined),
    findRequestLog: vi.fn(async () => []),
    findDirectoryOwnership: vi.fn(async () => []),
    findDirectoryExternalIds: vi.fn(async () => []),
    findDirectoryIdentities: vi.fn(async () => []),
    findExpiredRequestIds: vi.fn(async () => []),
    deleteRequests: vi.fn(async () => 0),
    findUserResource: vi.fn(async () => null),
    findUserByResourceName: vi.fn(async () => null),
    hasLegacyNameConflict: vi.fn(async () => false),
    saveUserResource: vi.fn(async (input) => ({
      ...input,
      deletedAt: null,
      createdAt: fromDate(new Date(0)),
      updatedAt: fromDate(new Date(0)),
    })),
    markUserResourceDeleted: vi.fn(async () => undefined),
    addMembership: vi.fn(async () => undefined),
    removeMembership: vi.fn(async () => undefined),
    findGroup: vi.fn(async () => null),
    findGroupByExternalId: vi.fn(async () => null),
    listGroups: vi.fn(async () => ({ rows: [], total: 0 })),
    createGroup: vi.fn(),
    renameGroup: vi.fn(async () => undefined),
    deleteGroup: vi.fn(async () => undefined),
    findGroupMembers: vi.fn(async () => []),
    findGroupMemberIds: vi.fn(async () => []),
    addGroupMember: vi.fn(async () => undefined),
    removeGroupMembers: vi.fn(async () => undefined),
    groupSlugExists: vi.fn(async () => false),
    findRoleBindings: vi.fn(async () => []),
    scimConnectionExists: vi.fn(async () => true),
    findDirectoryUserId: vi.fn(async () => null),
    rememberDirectoryIdentity: vi.fn(async () => undefined),
    forgetDirectoryIdentity: vi.fn(async () => undefined),
    forgetDirectoryIdentitiesForUser: vi.fn(async () => undefined),
    findDirectoryConnectionsForUser: vi.fn(async () => []),
    ...overrides,
  };
}
