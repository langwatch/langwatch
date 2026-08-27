// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { AuthzGrantsService } from "@langwatch/authz-contract";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import { EntitlementService } from "@langwatch/entitlement-contract";
import {
  SCIM_ENTERPRISE_USER_SCHEMA,
  type ScimCreateUserRequest,
} from "@langwatch/enterprise-scim-contract";
import type { ScimRepositoryPort } from "../src/ports/scim-repository.port";
import { ScimService } from "../src/services/scim.service";
import type { UserProfile, UserService } from "@langwatch/user-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuietScimSyncLifecycle } from "./support/quiet-scim-sync-lifecycle";

const now = new Date("2026-08-25T12:00:00.000Z");

function user(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "user-1",
    name: "Alice Smith",
    email: "alice@acme.com",
    emailVerified: false,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-02T00:00:00Z"),
    lastLoginAt: null,
    deactivatedAt: null,
    ...overrides,
  };
}

function repository(overrides: Partial<ScimRepositoryPort> = {}): ScimRepositoryPort {
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

class GrantsFake extends AuthzGrantsService {
  readonly attach = vi.fn();
  readonly update = vi.fn();
  readonly revoke = vi.fn();
  readonly replace = vi.fn();
  readonly offboard = vi.fn();
  readonly attachBindings = vi.fn(async () => []);
  readonly attachResourceGrant = vi.fn();
  readonly revokeResourceGrants = vi.fn();
  readonly changeBindingRole = vi.fn();
  readonly revokeBindings = vi.fn(async () => []);
  readonly offboardMember = vi.fn(async () => undefined);
  readonly revokeBindingsWhere = vi.fn();
  readonly defineRole = vi.fn();
  readonly deleteRole = vi.fn();
  readonly createBinding = vi.fn();
  readonly updateBinding = vi.fn();
  readonly deleteBinding = vi.fn();
  readonly applyMemberBindings = vi.fn();
}

class EnterpriseEntitlements extends EntitlementService {
  async getActivePlan() {
    return {
      planSource: "free" as const,
      type: "ENTERPRISE",
      name: "Enterprise",
      free: false,
      maxMembers: 1,
      maxMembersLite: 1,
      maxMessagesPerMonth: 1,
      canPublish: true,
      prices: { USD: 0, EUR: 0 },
    };
  }
}

function harness(
  options: {
    repository?: ScimRepositoryPort;
    existingUser?: UserProfile | null;
    membership?: unknown;
    currentUser?: UserProfile | null;
  } = {},
) {
  const repo = options.repository ?? repository();
  let currentUser = options.currentUser ?? user();
  const users = {
    getProfiles: vi.fn(),
    tryFindByEmail: vi.fn(async () => options.existingUser ?? null),
    tryFindById: vi.fn(async () => currentUser),
    create: vi.fn(async () => currentUser),
    updateProfile: vi.fn(async () => currentUser),
    deactivate: vi.fn(async () => {
      currentUser = user({ ...currentUser, deactivatedAt: now });
      return currentUser;
    }),
    reactivate: vi.fn(async () => {
      currentUser = user({ ...currentUser, deactivatedAt: null });
      return currentUser;
    }),
  } as UserService;
  const governance = {
    departmentResolveByNameOrCreate: vi.fn(async () => ({
      id: "department-1",
      organizationId: "org-1",
      name: "Engineering",
    })),
    departmentAssignUser: vi.fn(async () => undefined),
  } as GovernanceService;
  const writer = new GrantsFake();
  const service = ScimService.create({
    prisma: repo,
    writer,
    users,
    governance,
    entitlements: new EnterpriseEntitlements(),
    lifecycle: new QuietScimSyncLifecycle(),
    provenOffboarding: false,
  });
  if (options.membership !== void 0) {
    vi.mocked(repo.tryFindMembership).mockResolvedValue(options.membership as never);
  }
  return { repo, users, governance, writer, service };
}

describe("SCIM user parity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps an active user to SCIM with split names and metadata", () => {
    const { service } = harness();

    expect(service.toScimUser(user())).toEqual({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: "user-1",
      userName: "alice@acme.com",
      name: { givenName: "Alice", familyName: "Smith" },
      emails: [{ primary: true, value: "alice@acme.com", type: "work" }],
      active: true,
      meta: {
        resourceType: "User",
        created: "2024-01-01T00:00:00.000Z",
        lastModified: "2024-01-02T00:00:00.000Z",
      },
    });
  });

  it("maps a deactivated user as inactive", () => {
    const { service } = harness();

    expect(service.toScimUser(user({ deactivatedAt: now })).active).toBe(false);
  });

  it("maps a single-name user without inventing a family name", () => {
    const { service } = harness();

    expect(service.toScimUser(user({ name: "Alice" })).name).toEqual({
      givenName: "Alice",
      familyName: "",
    });
  });

  it("creates a user and its organization membership", async () => {
    const created = user();
    const { repo, users, service } = harness({ currentUser: created });
    vi.mocked(users.tryFindByEmail).mockResolvedValue(null);
    vi.mocked(users.create).mockResolvedValue(created);

    await expect(
      service.createUser({
        organizationId: "org-1",
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "alice@acme.com",
          name: { givenName: "Alice", familyName: "Smith" },
        },
      }),
    ).resolves.toMatchObject({ id: "user-1", userName: "alice@acme.com" });
    expect(users.create).toHaveBeenCalledWith({
      name: "Alice Smith",
      email: "alice@acme.com",
    });
    expect(repo.addMembership).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-1",
      role: "MEMBER",
    });
  });

  it("rejects a user already belonging to the organization with 409", async () => {
    const { service } = harness({
      existingUser: user(),
      membership: { userId: "user-1" },
    });

    await expect(
      service.createUser({
        organizationId: "org-1",
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "alice@acme.com",
        },
      }),
    ).rejects.toMatchObject({ response: { status: "409" } });
  });

  it("adds an existing user to a different organization", async () => {
    const existing = user();
    const { repo, service } = harness({ existingUser: existing, membership: null });

    await expect(
      service.createUser({
        organizationId: "org-2",
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "alice@acme.com",
        },
      }),
    ).resolves.toMatchObject({ id: "user-1" });
    expect(repo.addMembership).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-2",
      role: "MEMBER",
    });
  });

  it("repairs the grant when membership creation loses a uniqueness race", async () => {
    const addMembership = vi.fn(async () => {
      throw { code: "P2002" };
    });
    const repo = repository({
      addMembership,
      listRoleBindings: vi.fn(async () => []),
    });
    const { writer, service } = harness({
      repository: repo,
      existingUser: user(),
      membership: null,
    });

    await expect(
      service.createUser({
        organizationId: "org-1",
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "alice@acme.com",
        },
      }),
    ).resolves.toMatchObject({ id: "user-1" });
    expect(writer.attachBindings).toHaveBeenCalledOnce();
  });

  it("reconciles only the SCIM organization-membership grant slice", async () => {
    const listRoleBindings = vi.fn(async () => [
      {
        id: "org-member",
        userId: "user-1",
        groupId: null,
        apiKeyId: null,
        scopeType: "ORGANIZATION",
        scopeId: "org-1",
        role: "MEMBER",
        customRoleId: null,
      },
    ]);
    const repo = repository({ listRoleBindings });
    const { writer, service } = harness({
      repository: repo,
      existingUser: user(),
      membership: null,
    });

    await service.createUser({
      organizationId: "org-1",
      request: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "alice@acme.com",
      },
    });

    expect(listRoleBindings).toHaveBeenCalledWith({
      kind: "organization-membership",
      organizationId: "org-1",
      userId: "user-1",
    });
    expect(writer.revokeBindings).not.toHaveBeenCalled();
  });

  it("returns a member and rejects a user outside the organization", async () => {
    const member = user();
    const found = harness({ membership: { user: member } });
    await expect(
      found.service.getUser({ id: "user-1", organizationId: "org-1" }),
    ).resolves.toMatchObject({
      id: "user-1",
    });

    const missing = harness({ membership: null });
    await expect(
      missing.service.getUser({ id: "user-1", organizationId: "org-1" }),
    ).rejects.toMatchObject({ response: { status: "404" } });
  });

  it("lists members and passes an exact userName filter to persistence", async () => {
    const repo = repository({
      listMemberships: vi.fn(async () => ({ rows: [{ user: user() }], total: 1 })),
    });
    const { service } = harness({ repository: repo });

    await expect(
      service.listUsers({
        organizationId: "org-1",
        filter: 'userName eq "alice@acme.com"',
      }),
    ).resolves.toMatchObject({
      totalResults: 1,
      Resources: [{ userName: "alice@acme.com" }],
    });
    expect(repo.listMemberships).toHaveBeenCalledWith({
      organizationId: "org-1",
      email: "alice@acme.com",
      startIndex: 1,
      count: 100,
    });
  });

  it("deactivates and removes a member on delete, sweeping visible grants", async () => {
    const repo = repository({
      tryFindMembership: vi.fn(async () => ({ user: user() })),
      listRoleBindings: vi.fn(async () => [
        {
          id: "grant-1",
          userId: "user-1",
          groupId: null,
          apiKeyId: null,
          scopeType: "ORGANIZATION",
          scopeId: "org-1",
          role: "MEMBER",
          customRoleId: null,
        },
      ]),
    });
    const { repo: usedRepo, users, writer, service } = harness({ repository: repo });

    await expect(
      service.deleteUser({ id: "user-1", organizationId: "org-1" }),
    ).resolves.toBeUndefined();
    expect(writer.offboardMember).toHaveBeenCalledWith(
      expect.objectContaining({ revokedGrantIds: ["grant-1"], organizationId: "org-1" }),
    );
    expect(usedRepo.removeMembership).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-1",
    });
    expect(users.deactivate).toHaveBeenCalledWith({ id: "user-1" });
  });

  it("rejects deleting a user outside the organization", async () => {
    const { service } = harness({ membership: null });

    await expect(
      service.deleteUser({ id: "user-1", organizationId: "org-1" }),
    ).rejects.toMatchObject({
      response: { status: "404" },
    });
  });

  it("deactivates a user through an active=false PATCH", async () => {
    const { users, service } = harness({
      membership: { user: user() },
      currentUser: user({ deactivatedAt: now }),
    });

    await expect(
      service.updateUser({
        id: "user-1",
        organizationId: "org-1",
        patchRequest: {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [{ op: "replace", path: "active", value: false }],
        },
      }),
    ).resolves.toMatchObject({ active: false });
    expect(users.deactivate).toHaveBeenCalledWith({ id: "user-1" });
  });

  it("deactivates a user through a full replace", async () => {
    const { users, service } = harness({ membership: { user: user() } });

    await expect(
      service.replaceUser({
        id: "user-1",
        organizationId: "org-1",
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "alice@acme.com",
          name: { givenName: "Alice", familyName: "Smith" },
          active: false,
        },
      }),
    ).resolves.toMatchObject({ active: false });
    expect(users.deactivate).toHaveBeenCalledWith({ id: "user-1" });
  });
});

describe("SCIM enterprise cost-center parity", () => {
  const request = (costCenter: string | null | undefined): ScimCreateUserRequest => ({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName: "alice@acme.com",
    name: { givenName: "Alice", familyName: "Smith" },
    ...(costCenter === undefined ? {} : { [SCIM_ENTERPRISE_USER_SCHEMA]: { costCenter } }),
  });

  it("assigns a named department on create", async () => {
    const { governance, service } = harness({ currentUser: user() });
    await service.createUser({
      organizationId: "org-1",
      request: request("Engineering"),
    });
    expect(governance.departmentResolveByNameOrCreate).toHaveBeenCalledWith({
      organizationId: "org-1",
      name: "Engineering",
    });
    expect(governance.departmentAssignUser).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "user-1",
      departmentId: "department-1",
    });
  });

  it("resolves an unrecognised department through Governance before assigning it", async () => {
    const { governance, service } = harness({ currentUser: user() });
    vi.mocked(governance.departmentResolveByNameOrCreate).mockResolvedValue({
      id: "department-research",
      organizationId: "org-1",
      name: "Research",
    });
    await service.createUser({ organizationId: "org-1", request: request("Research") });
    expect(governance.departmentAssignUser).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "user-1",
      departmentId: "department-research",
    });
  });

  it("reassigns a member when a PATCH changes costCenter", async () => {
    const { governance, service } = harness({ membership: { user: user() } });
    await service.updateUser({
      id: "user-1",
      organizationId: "org-1",
      patchRequest: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [
          {
            op: "replace",
            path: `${SCIM_ENTERPRISE_USER_SCHEMA}:costCenter`,
            value: "Marketing",
          },
        ],
      },
    });
    expect(governance.departmentResolveByNameOrCreate).toHaveBeenCalledWith({
      organizationId: "org-1",
      name: "Marketing",
    });
  });

  it("clears a member's department when costCenter is removed", async () => {
    const { governance, service } = harness({ membership: { user: user() } });
    await service.updateUser({
      id: "user-1",
      organizationId: "org-1",
      patchRequest: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "remove", path: `${SCIM_ENTERPRISE_USER_SCHEMA}:costCenter` }],
      },
    });
    expect(governance.departmentAssignUser).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "user-1",
      departmentId: null,
    });
  });
});
