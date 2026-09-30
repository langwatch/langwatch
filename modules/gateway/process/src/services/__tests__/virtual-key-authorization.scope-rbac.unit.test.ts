/**
 * The per-scope permission contract for virtual keys: what each scope demands
 * to create, operate on and see a key, and that no scope reaches across
 * organizations.
 * @see specs/ai-gateway/governance/vk-scope-rbac.feature
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import type { GatewayPermissionScope, GatewayScopePermissions } from "../../app/gateway.members.ts";
import { VirtualKeyAuthorizationRepository } from "../../repositories/virtual-key-authorization.repository.ts";
import {
  type ActorContext,
  type Scope,
  VirtualKeyAuthorizationService,
} from "../virtual-key-authorization.service.ts";

const ORG: Scope = { scopeType: "ORGANIZATION", scopeId: "acme" };
const PLATFORM: Scope = { scopeType: "TEAM", scopeId: "platform" };
const DATA_SCI: Scope = { scopeType: "TEAM", scopeId: "data-sci" };
const DEMO: Scope = { scopeType: "PROJECT", scopeId: "demo" };
const ML_PROD: Scope = { scopeType: "PROJECT", scopeId: "ml-prod" };

type Grant = { permission: AuthzPermission; at: "org" | "team" | "project"; id: string };

const ALL_TEAMS: Record<string, true> = { platform: true, "data-sci": true };
const TEAM_OF_PROJECT: Record<string, string> = { demo: "platform", "ml-prod": "data-sci" };

/** A grant reaches its own scope and everything beneath it, and nothing beside it. */
function grantReaches(grant: Grant, scope: GatewayPermissionScope): boolean {
  if (grant.at === "org") return scope.type === "org" ? scope.id === grant.id : true;
  if (grant.at === "team") {
    if (scope.type === "team") return scope.id === grant.id;
    return scope.type === "project" && scope.teamId === grant.id;
  }
  return scope.type === "project" && scope.id === grant.id;
}

function permissionsFor(grants: Grant[]): GatewayScopePermissions {
  const holds = async ({
    permission,
    scope,
  }: {
    permission: AuthzPermission;
    scope: GatewayPermissionScope;
  }) => grants.some((grant) => grant.permission === permission && grantReaches(grant, scope));
  return { sessionHolds: holds, apiKeyHolds: holds };
}

function sessionWith(grants: Grant[]): ActorContext {
  return {
    actor: { kind: "session", session: { user: { id: "user_1" } } },
    permissions: permissionsFor(grants),
  };
}

/** The organizations' directory: "acme" owns both teams and both projects. */
class AcmeDirectory extends VirtualKeyAuthorizationRepository {
  private readonly membership: { role: string | null; teamIds: string[] };

  constructor(
    membership: { role: string | null; teamIds: string[] } = { role: null, teamIds: [] },
  ) {
    super();
    this.membership = membership;
  }
  async findProjectTeam({ projectId }: { projectId: string }) {
    const teamId = TEAM_OF_PROJECT[projectId];
    return teamId ? { id: projectId, teamId } : null;
  }
  async findOrganizationRole() {
    return this.membership.role ? { role: this.membership.role } : null;
  }
  async findMemberTeamIds() {
    return this.membership.teamIds;
  }
  async findProjectIdsForTeams({ teamIds }: { teamIds: string[] }) {
    return Object.entries(TEAM_OF_PROJECT)
      .filter(([, team]) => teamIds.includes(team))
      .map(([project]) => project);
  }
  async findTeamIdsInOrganization({
    organizationId,
    teamIds,
  }: {
    organizationId: string;
    teamIds: string[];
  }) {
    return organizationId === "acme" ? teamIds.filter((id) => id in ALL_TEAMS) : [];
  }
  async findProjectIdsInOrganization({
    organizationId,
    projectIds,
  }: {
    organizationId: string;
    projectIds: string[];
  }) {
    return organizationId === "acme" ? projectIds.filter((id) => id in TEAM_OF_PROJECT) : [];
  }
  async findVirtualKeyScopes() {
    return null;
  }
  async findGuardrailIdsInProject() {
    return [];
  }
}

const service = (directory = new AcmeDirectory()) =>
  VirtualKeyAuthorizationService.create({ directory });

const manage = (at: Grant["at"], id: string): Grant => ({
  permission: "virtualKeys:manage",
  at,
  id,
});

describe("creating a key", () => {
  /** @scenario Creating an ORG-scoped VK requires virtualKeys:manage at ORGANIZATION scope */
  it("passes an organization key for manage at the organization", async () => {
    await expect(
      service().assertActorCanManageAllScopes(sessionWith([manage("org", "acme")]), [ORG]),
    ).resolves.toBeUndefined();
  });

  /** @scenario Creating an ORG-scoped VK without org:manage on virtualKeys is rejected */
  it("refuses an organization key to a holder of manage at one team, naming the permission", async () => {
    await expect(
      service().assertActorCanManageAllScopes(sessionWith([manage("team", "platform")]), [ORG]),
    ).rejects.toMatchObject({
      code: "permission_denied",
      httpStatus: 403,
      meta: { permission: "virtualKeys:manage", scopeType: "organization" },
    });
  });

  /** @scenario Creating a TEAM-scoped VK requires virtualKeys:manage at that team */
  it("passes a team key for manage at that team", async () => {
    await expect(
      service().assertActorCanManageAllScopes(sessionWith([manage("team", "platform")]), [
        PLATFORM,
      ]),
    ).resolves.toBeUndefined();
  });

  /** @scenario User with TEAM "platform" perm cannot create a VK in TEAM "data-sci" */
  it("refuses a sibling team's key", async () => {
    await expect(
      service().assertActorCanManageAllScopes(sessionWith([manage("team", "platform")]), [
        DATA_SCI,
      ]),
    ).rejects.toMatchObject({ code: "permission_denied", httpStatus: 403 });
  });

  /** @scenario Creating a PROJECT-scoped VK requires virtualKeys:manage at that project (or upward) */
  it("passes a project key for manage at that project", async () => {
    await expect(
      service().assertActorCanManageAllScopes(sessionWith([manage("project", "demo")]), [DEMO]),
    ).resolves.toBeUndefined();
  });

  /** @scenario virtualKeys:manage at ORGANIZATION scope allows creating VKs at any narrower scope */
  it("lets manage at the organization create at every narrower scope", async () => {
    const ctx = sessionWith([manage("org", "acme")]);
    for (const scope of [PLATFORM, DEMO, ORG]) {
      await expect(service().assertActorCanManageAllScopes(ctx, [scope])).resolves.toBeUndefined();
    }
  });

  /** @scenario virtualKeys:manage at TEAM scope allows creating VKs at projects within that team */
  it("lets manage at a team reach its projects and not a sibling team's", async () => {
    const ctx = sessionWith([manage("team", "platform")]);
    await expect(service().assertActorCanManageAllScopes(ctx, [DEMO])).resolves.toBeUndefined();
    await expect(service().assertActorCanManageAllScopes(ctx, [ML_PROD])).rejects.toMatchObject({
      code: "permission_denied",
      httpStatus: 403,
    });
  });

  /** @scenario Creating a VK with multiple scopes requires manage on EACH scope (intersection of grants) */
  it("refuses a multi-scope key and names the scope the caller cannot manage", async () => {
    await expect(
      service().assertActorCanManageAllScopes(sessionWith([manage("team", "platform")]), [
        PLATFORM,
        DATA_SCI,
      ]),
    ).rejects.toMatchObject({
      code: "permission_denied",
      meta: { permission: "virtualKeys:manage", scopeType: "team" },
    });
  });

  /** @scenario User with manage at both teams can create the cross-team VK */
  it("passes a cross-team key for manage at both teams", async () => {
    await expect(
      service().assertActorCanManageAllScopes(
        sessionWith([manage("team", "platform"), manage("team", "data-sci")]),
        [PLATFORM, DATA_SCI],
      ),
    ).resolves.toBeUndefined();
  });

  /** @scenario New VK routes work for a non-ADMIN user with explicit perm grants */
  it("needs nothing beyond the explicit grant, no admin role", async () => {
    await expect(
      service().assertActorCanManageAllScopes(sessionWith([manage("project", "demo")]), [DEMO]),
    ).resolves.toBeUndefined();
  });
});

describe("operating on an existing key", () => {
  /** @scenario Deleting a VK requires virtualKeys:delete at one of the VK's scopes */
  it("refuses a delete to a holder of view only", async () => {
    const ctx = sessionWith([{ permission: "virtualKeys:view", at: "team", id: "platform" }]);

    await expect(
      service().assertActorCanOperateOnAnyScope(ctx, [PLATFORM], "virtualKeys:delete"),
    ).rejects.toMatchObject({
      code: "permission_denied",
      httpStatus: 403,
      meta: { permission: "virtualKeys:delete" },
    });
  });

  it("passes a delete for the grant at any one of the key's scopes", async () => {
    const ctx = sessionWith([{ permission: "virtualKeys:delete", at: "team", id: "data-sci" }]);

    await expect(
      service().assertActorCanOperateOnAnyScope(ctx, [PLATFORM, DATA_SCI], "virtualKeys:delete"),
    ).resolves.toBeUndefined();
  });
});

describe("a credential that is not a session", () => {
  const apiKeyWith = (grants: Grant[]): ActorContext => ({
    actor: { kind: "apiKey", apiKeyId: "key_1", userId: "user_1", organizationId: "acme" },
    permissions: permissionsFor(grants),
  });
  const legacyKey: ActorContext = {
    actor: { kind: "legacyProjectKey", projectId: "demo" },
    permissions: permissionsFor([]),
  };

  /** @scenario An org-admin API key provisions an org-scoped key */
  it("lets an API key holding manage at the organization provision an organization key", async () => {
    await expect(
      service().assertActorCanManageAllScopes(apiKeyWith([manage("org", "acme")]), [ORG]),
    ).resolves.toBeUndefined();
  });

  /** @scenario Re-scoping over REST demands manage at the new scope */
  it("refuses a legacy project key any scope beyond its own project", async () => {
    await expect(service().assertActorCanManageAllScopes(legacyKey, [ORG])).rejects.toMatchObject({
      code: "permission_denied",
      httpStatus: 403,
    });
    await expect(
      service().assertActorCanManageAllScopes(legacyKey, [DEMO]),
    ).resolves.toBeUndefined();
  });
});

describe("a key never reaches into another organization", () => {
  /** @scenario A create cannot bind a scope from a different org than its organizationId */
  it("refuses a team that belongs to another organization", async () => {
    await expect(
      service().assertScopesBelongToOrg({ organizationId: "evilcorp", scopes: [PLATFORM] }),
    ).rejects.toMatchObject({
      code: "gateway_scope_org_mismatch",
      httpStatus: 400,
      meta: { scope_type: "team" },
    });
  });

  it("refuses a project that belongs to another organization", async () => {
    await expect(
      service().assertScopesBelongToOrg({ organizationId: "evilcorp", scopes: [DEMO] }),
    ).rejects.toMatchObject({
      code: "gateway_scope_org_mismatch",
      meta: { scope_type: "project" },
    });
  });

  /** @scenario An ORGANIZATION scope must equal the organizationId */
  it("refuses an organization scope naming a different organization", async () => {
    await expect(
      service().assertScopesBelongToOrg({ organizationId: "evilcorp", scopes: [ORG] }),
    ).rejects.toMatchObject({
      code: "gateway_scope_org_mismatch",
      httpStatus: 400,
      meta: { scope_type: "organization" },
    });
  });

  it("accepts the organization's own scopes", async () => {
    await expect(
      service().assertScopesBelongToOrg({
        organizationId: "acme",
        scopes: [ORG, PLATFORM, DEMO],
      }),
    ).resolves.toBeUndefined();
  });
});

describe("which keys a caller sees", () => {
  const vkOrg = [ORG];
  const vkTeamPlatform = [PLATFORM];
  const vkTeamDataSci = [DATA_SCI];

  /** @scenario A user sees VKs whose scopes intersect their membership set */
  it("shows organization and own-team keys and hides another team's", async () => {
    const sut = service(new AcmeDirectory({ role: "MEMBER", teamIds: ["platform"] }));
    const membership = await sut.loadMembershipSet({ organizationId: "acme", userId: "olive" });

    expect(sut.isVisibleToMembership(membership, vkOrg)).toBe(true);
    expect(sut.isVisibleToMembership(membership, vkTeamPlatform)).toBe(true);
    expect(sut.isVisibleToMembership(membership, vkTeamDataSci)).toBe(false);
  });

  /** @scenario An org ADMIN with no TeamUser rows sees project-scoped VKs (e.g. the auto-managed Langy VK) anywhere in the org */
  it("shows an organization admin every project key with no team rows", async () => {
    const sut = service(new AcmeDirectory({ role: "ADMIN", teamIds: [] }));
    const membership = await sut.loadMembershipSet({ organizationId: "acme", userId: "admin" });

    expect(sut.isVisibleToMembership(membership, [DEMO])).toBe(true);
    expect(sut.isVisibleToMembership(membership, [ML_PROD])).toBe(true);
  });

  /** @scenario A plain MEMBER still does NOT see a sibling-team project VK — the admin short-circuit must not leak to members */
  it("hides a sibling team's project key from a plain member", async () => {
    const sut = service(new AcmeDirectory({ role: "MEMBER", teamIds: ["platform"] }));
    const membership = await sut.loadMembershipSet({ organizationId: "acme", userId: "mona" });

    expect(sut.isVisibleToMembership(membership, [ML_PROD])).toBe(false);
    expect(sut.isVisibleToMembership(membership, [DEMO])).toBe(true);
  });
});
