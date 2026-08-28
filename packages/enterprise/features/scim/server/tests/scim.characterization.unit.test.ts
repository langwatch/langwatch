// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createHash } from "node:crypto";
import { AuthzGrantsService } from "@langwatch/authz-contract";
import type { AuthService } from "@langwatch/auth-contract";
import { describe, expect, it, vi } from "vitest";
import type { UserService } from "@langwatch/user-contract";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import { EntitlementService } from "@langwatch/entitlement-contract";
import { ScimService } from "../src/services/scim.service";
import { ScimProtocolError } from "@langwatch/enterprise-scim-contract";
import type { ScimRepositoryPort } from "../src/ports/scim-repository.port";
import { QuietScimSyncLifecycle } from "./support/quiet-scim-sync-lifecycle";
import type { ScimSyncLifecyclePort } from "../src/ports/scim-sync-lifecycle.port";

const now = new Date("2026-08-25T12:00:00.000Z");

function repository(overrides: Record<string, unknown> = {}): ScimRepositoryPort {
  return {
    tryFindOrganizationBySsoDomain: vi.fn(),
    createToken: vi.fn(async () => ({ id: "token_1" })),
    listTokens: vi.fn(async () => []),
    tryFindToken: vi.fn(async () => null),
    revokeToken: vi.fn(async () => false),
    revokeTokensForConnection: vi.fn(async () => 0),
    tryFindTokenByHash: vi.fn(async () => null),
    recordTokenUse: vi.fn(async () => undefined),
    scimConnectionExists: vi.fn(async () => true),
    tryFindDirectoryUserId: vi.fn(async () => null),
    rememberDirectoryIdentity: vi.fn(async () => undefined),
    forgetDirectoryIdentity: vi.fn(async () => undefined),
    forgetDirectoryIdentitiesForUser: vi.fn(async () => undefined),
    listDirectoryConnectionsForUser: vi.fn(async () => []),
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
    ...overrides,
  } as ScimRepositoryPort;
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
  readonly revokeBindingsWhere = vi.fn();
  readonly offboardMember = vi.fn();
  readonly defineRole = vi.fn();
  readonly deleteRole = vi.fn();
  readonly createBinding = vi.fn();
  readonly updateBinding = vi.fn();
  readonly deleteBinding = vi.fn();
  readonly applyMemberBindings = vi.fn();
}

class FixedEntitlementService extends EntitlementService {
  constructor(private readonly enterprise: boolean) {
    super();
  }

  async getActivePlan() {
    return {
      planSource: "free" as const,
      type: this.enterprise ? "ENTERPRISE" : "FREE",
      name: "Test",
      free: !this.enterprise,
      maxMembers: 1,
      maxMembersLite: 1,
      maxMessagesPerMonth: 1,
      canPublish: false,
      prices: { USD: 0, EUR: 0 },
    };
  }
}

function service(
  repo: ScimRepositoryPort,
  enterprise = true,
  lifecycle: ScimSyncLifecyclePort = new QuietScimSyncLifecycle(),
): ScimService {
  return ScimService.create({
    prisma: repo,
    writer: new GrantsFake(),
    auth: { revokeAllBrowserSessions: vi.fn(async () => undefined) } as AuthService,
    users: {
      tryFindByEmail: vi.fn(async () => null),
      tryFindById: vi.fn(async () => null),
      create: vi.fn(),
      updateProfile: vi.fn(),
      deactivate: vi.fn(),
      reactivate: vi.fn(),
    } as UserService,
    governance: {
      departmentResolveByNameOrCreate: vi.fn(async () => ({
        id: "department_1",
        organizationId: "org_1",
        name: "Engineering",
      })),
      departmentAssignUser: vi.fn(async () => undefined),
    } as GovernanceService,
    entitlements: new FixedEntitlementService(enterprise),
    lifecycle,
    provenOffboarding: false,
  });
}

describe("SCIM characterization: token lifecycle", () => {
  it("mints only a hash, lists summaries, updates use on entitled verification, and retains 404 revocation", async () => {
    const repo = repository({
      listTokens: vi.fn(async () => [
        {
          id: "token_1",
          organizationId: "org_1",
          connectionId: "connection_1",
          description: "okta",
          createdAt: now,
          lastUsedAt: null,
        },
      ]),
      tryFindTokenByHash: vi.fn(async () => ({
        id: "token_1",
        organizationId: "org_1",
        connectionId: "connection_1",
      })),
      revokeToken: vi.fn(async () => true),
    });
    const scim = service(repo);
    const minted = await scim.generateToken({
      organizationId: "org_1",
      connectionId: "connection_1",
      description: "okta",
    });
    expect(minted.token).toHaveLength(64);
    expect(repo.createToken).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        hashedToken: createHash("sha256").update(minted.token).digest("hex"),
      }),
    );
    expect(await scim.listTokens({ organizationId: "org_1" })).toEqual([
      expect.objectContaining({ id: "token_1", description: "okta" }),
    ]);
    expect(await scim.verifyToken({ token: minted.token })).toEqual({
      status: "ok",
      organizationId: "org_1",
      connectionId: "connection_1",
    });
    expect(repo.recordTokenUse).toHaveBeenCalledWith(
      expect.objectContaining({ tokenId: "token_1" }),
    );
    await expect(
      scim.revokeToken({ organizationId: "org_1", tokenId: "token_1" }),
    ).resolves.toEqual({ success: true });
  });

  it("states token issue, revoke, and connection teardown on the injected lifecycle", async () => {
    const lifecycle = new (class extends QuietScimSyncLifecycle {
      tokenIssued = vi.fn(async () => undefined);
      revoked = vi.fn(async () => undefined);
    })();
    const repo = repository({
      tryFindToken: vi.fn(async () => ({
        id: "token_1",
        organizationId: "org_1",
        connectionId: "connection_1",
      })),
      revokeToken: vi.fn(async () => true),
      revokeTokensForConnection: vi.fn(async () => 2),
    });
    const scim = service(repo, true, lifecycle);

    await scim.generateToken({
      organizationId: "org_1",
      connectionId: "connection_1",
    });
    await scim.revokeToken({ organizationId: "org_1", tokenId: "token_1" });
    await scim.revokeTokensForConnection({
      organizationId: "org_1",
      connectionId: "connection_1",
    });

    expect(lifecycle.tokenIssued).toHaveBeenCalledWith({
      organizationId: "org_1",
      connectionId: "connection_1",
      tokenId: "token_1",
    });
    expect(lifecycle.revoked).toHaveBeenNthCalledWith(1, {
      organizationId: "org_1",
      connectionId: "connection_1",
      tokenId: "token_1",
      cause: "revoke",
    });
    expect(lifecycle.revoked).toHaveBeenNthCalledWith(2, {
      organizationId: "org_1",
      connectionId: "connection_1",
      tokenId: null,
      cause: "teardown",
    });
  });

  it("distinguishes invalid credentials, lapsed plans, and unknown revocation", async () => {
    const repo = repository({
      tryFindTokenByHash: vi.fn(async () => ({
        id: "token_1",
        organizationId: "org_1",
        connectionId: "connection_1",
      })),
    });
    expect(await service(repository()).verifyToken({ token: "bad" })).toEqual({
      status: "invalid_token",
    });
    expect(await service(repo, false).verifyToken({ token: "valid" })).toEqual({
      status: "plan_not_entitled",
      organizationId: "org_1",
    });
    await expect(
      service(repository()).revokeToken({ organizationId: "org_1", tokenId: "gone" }),
    ).rejects.toMatchObject({ code: "scim_token_not_found" });
  });
});

describe("SCIM characterization: provisioning invariants", () => {
  it("caps neither repository semantics nor response shape: list response preserves requested page values", async () => {
    const repo = repository({
      listMemberships: vi.fn(async () => ({ rows: [], total: 0 })),
    });
    await expect(
      service(repo).listUsers({ organizationId: "org_1", startIndex: 1, count: 100 }),
    ).resolves.toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 0,
      startIndex: 1,
      itemsPerPage: 100,
      Resources: [],
    });
  });

  it("keeps grant reconciliation as the only membership-write path", async () => {
    const writer = new GrantsFake();
    const repo = repository({
      addMembership: vi.fn(async () => undefined),
      listRoleBindings: vi.fn(async () => []),
    });
    const users = {
      tryFindByEmail: vi.fn(async () => ({
        id: "user_1",
        email: "member@example.com",
        name: "Member",
        deactivatedAt: null,
        createdAt: now,
        updatedAt: now,
        emailVerified: true,
        image: null,
        pendingSsoSetup: false,
        lastLoginAt: null,
      })),
      tryFindById: vi.fn(async () => ({
        id: "user_1",
        email: "member@example.com",
        name: "Member",
        deactivatedAt: null,
        createdAt: now,
        updatedAt: now,
        emailVerified: true,
        image: null,
        pendingSsoSetup: false,
        lastLoginAt: null,
      })),
      reactivate: vi.fn(),
      create: vi.fn(),
      updateProfile: vi.fn(),
      deactivate: vi.fn(),
    } as UserService;
    const scim = ScimService.create({
      prisma: repo,
      users,
      writer,
      auth: { revokeAllBrowserSessions: vi.fn(async () => undefined) } as AuthService,
      governance: {
        departmentResolveByNameOrCreate: vi.fn(async () => ({
          id: "department_1",
          organizationId: "org_1",
          name: "Engineering",
        })),
        departmentAssignUser: vi.fn(async () => undefined),
      } as GovernanceService,
      entitlements: new FixedEntitlementService(true),
      lifecycle: new QuietScimSyncLifecycle(),
      provenOffboarding: false,
    });
    await scim.createUser({
      organizationId: "org_1",
      request: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "member@example.com",
      },
    });
    expect(repo.addMembership).toHaveBeenCalledOnce();
    expect(writer.attachBindings).toHaveBeenCalledOnce();
  });

  it("uses a typed protocol exception rather than an error-value union for missing users", async () => {
    await expect(
      service(repository()).getUser({ organizationId: "org_1", id: "missing" }),
    ).rejects.toMatchObject({
      name: "ScimProtocolError",
      response: { status: "404", detail: "User not found" },
    } satisfies Partial<ScimProtocolError>);
  });
});
