/**
 * Every key door hands its caller the key's owning user, and no actor for a key no person
 * owns (ARCHITECTURE §8).
 */
import type {
  ApiKeyTokenResolutionInput,
  OrganizationApiKeyResolution,
  ResolvedApiKeyCredential,
} from "@langwatch/api-key-contract";
import type { RestIdentity } from "@langwatch/api/hosting";
import { ForbiddenError } from "@langwatch/api/rest";
import { AuthzScopeNotFoundError, type AuthzApi } from "@langwatch/authz-contract";
import type { Plan } from "@langwatch/entitlement-contract";
import { describe, expect, it, vi } from "vitest";

import { ApiDoorService, type ApiDoorPeers } from "../api-door.service.ts";

const PROJECT = {
  id: "project-1",
  name: "Project",
  slug: "project",
  teamId: "team-1",
  organizationId: "org-1",
  isPersonal: false,
  ownerUserId: null,
};

function projectKey(
  apiKeyId: string,
  userId: string | null,
): Extract<ResolvedApiKeyCredential, { type: "apiKey" }> {
  return {
    type: "apiKey",
    apiKeyId,
    userId,
    organizationId: "org-1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    project: PROJECT,
  };
}

function organizationKey(apiKeyId: string, userId: string | null): OrganizationApiKeyResolution {
  return { ok: true, resolved: { type: "apiKey-org", apiKeyId, userId, organizationId: "org-1" } };
}

const projectTokens = new Map<string, ResolvedApiKeyCredential>([
  ["sk-lw-owned", projectKey("key-owned", "user-1")],
  ["sk-lw-unowned", projectKey("key-unowned", null)],
  ["sk-lw-unattended-run", { ...projectKey("key-run", null), isUnattendedRunKey: true }],
  ["legacy-key", { type: "legacyProjectKey", project: PROJECT }],
  ["sk-lw-ingest", { ...projectKey("key-ingest", null), ingestionTemplateId: "template-1" }],
]);
const organizationTokens = new Map<string, OrganizationApiKeyResolution>([
  ["sk-lw-org-owned", organizationKey("key-org-owned", "user-2")],
  ["sk-lw-org-unowned", organizationKey("key-org-unowned", null)],
]);

const refuseEverything = () => Promise.reject(new Error("an identified caller asks no permission"));
const peers: ApiDoorPeers = {
  sessions: { verifyBrowserSession: refuseEverything, resolveBrowserSession: refuseEverything },
  apiKeys: {
    findResolvedToken: ({ token }: ApiKeyTokenResolutionInput) =>
      Promise.resolve(projectTokens.get(token) ?? null),
    resolveOrganizationToken: ({ token }) =>
      Promise.resolve(
        organizationTokens.get(token) ?? { ok: false, reason: "unusable_credential" },
      ),
    markUsed: () => {},
  },
  cliProjects: {
    getCliAccessProject: ({ authorization }) =>
      authorization === "Bearer lw_at_bound"
        ? Promise.resolve({ userId: "user-3", organizationId: "org-1", project: PROJECT })
        : Promise.reject(new Error("a bearer bound to no project")),
  },
  authz: {
    hasApiKeyPermission: refuseEverything,
    hasProjectPermission: refuseEverything,
    getApiKeyProjectDecision: refuseEverything,
    listApiKeyBindings: refuseEverything,
    getDecision: refuseEverything,
    getProjectAnyDecision: refuseEverything,
    checkScopeLineage: refuseEverything,
    getSessionVersion: refuseEverything,
    getScope: refuseEverything,
    can: refuseEverything,
  },
  organizations: {
    getSettings: ({ organizationId }) =>
      Promise.resolve({
        id: organizationId,
        name: "Organization",
        slug: "organization",
        supportContact: null,
        presenceEnabled: false,
        traceSharingEnabled: false,
        primaryIntent: null,
        s3Endpoint: null,
        s3AccessKeyId: null,
        s3Bucket: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }),
    getOrganizationIdByTeamId: refuseEverything,
  },
  entitlements: { getActivePlan: refuseEverything },
  auditLog: { record: refuseEverything },
};

const { identities } = ApiDoorService.create(peers).door();

async function actorThrough(door: RestIdentity, headers: Record<string, string>) {
  if (!door.identify) throw new Error("every key door identifies a caller");
  const request = new Request("http://localhost/api/who", { headers });
  return (await door.identify({ request })).actor;
}

describe("the key doors' actor", () => {
  describe("given a project key a person owns", () => {
    const headers = { authorization: "Bearer sk-lw-owned", "x-project-id": "project-1" };

    it("is that person on the project door", async () => {
      expect(await actorThrough(identities.project, headers)).toEqual({
        type: "user",
        id: "user-1",
      });
    });

    it("is that person on the key door", async () => {
      expect(await actorThrough(identities.api_key, headers)).toEqual({
        type: "user",
        id: "user-1",
      });
    });
  });

  describe("given a project key no person owns", () => {
    const headers = { authorization: "Bearer sk-lw-unowned", "x-project-id": "project-1" };

    it("is no one on the project door", async () => {
      expect(await actorThrough(identities.project, headers)).toBeNull();
    });

    it("is no one on the key door", async () => {
      expect(await actorThrough(identities.api_key, headers)).toBeNull();
    });
  });

  describe("given the key of a run nobody started", () => {
    /** @scenario "A run nobody started acts as the system actor at the door" */
    it("is the system acting for an unattended run on the project door", async () => {
      const headers = { authorization: "Bearer sk-lw-unattended-run", "x-project-id": "project-1" };

      expect(await actorThrough(identities.project, headers)).toEqual({
        type: "system",
        name: "unattendedRun",
      });
    });
  });

  describe("given a legacy project key", () => {
    it("is no one on the project door", async () => {
      expect(await actorThrough(identities.project, { "x-auth-token": "legacy-key" })).toBeNull();
    });
  });

  describe("given a CLI access token bound to a project", () => {
    const headers = { authorization: "Bearer lw_at_bound" };

    it("is the person on the project door", async () => {
      expect(await actorThrough(identities.project, headers)).toEqual({
        type: "user",
        id: "user-3",
      });
    });

    it("is the person on the key door, where each feature admits or refuses it", async () => {
      expect(await actorThrough(identities.api_key, headers)).toEqual({
        type: "user",
        id: "user-3",
      });
    });
  });

  describe("given an organization key", () => {
    it("is its owner on the organization door when a person owns it", async () => {
      expect(
        await actorThrough(identities.organization, { authorization: "Bearer sk-lw-org-owned" }),
      ).toEqual({ type: "user", id: "user-2" });
    });

    it("is no one on the organization door when no person owns it", async () => {
      expect(
        await actorThrough(identities.organization, { authorization: "Bearer sk-lw-org-unowned" }),
      ).toBeNull();
    });
  });
});

describe("the project door's admitted key kinds", () => {
  function authenticate(headers: Record<string, string>) {
    return identities.project.authenticate({
      request: new Request("http://localhost/api/agents/connect/register", { headers }),
      permission: "scenarios:manage",
      permissions: ["scenarios:manage"],
      keyKinds: ["api_key"],
    });
  }

  describe("given an ingestion key on a route admitting only API keys", () => {
    it("refuses key_type_not_allowed before its permission is asked", async () => {
      await expect(
        authenticate({ authorization: "Bearer sk-lw-ingest", "x-project-id": "project-1" }),
      ).rejects.toMatchObject({ code: "key_type_not_allowed", httpStatus: 403 });
    });
  });

  describe("given a person's CLI access token on a route admitting only API keys", () => {
    it("refuses key_type_not_allowed before its permission is asked", async () => {
      await expect(authenticate({ authorization: "Bearer lw_at_bound" })).rejects.toMatchObject({
        code: "key_type_not_allowed",
      });
    });
  });
});

describe("a route asking several permissions (E2)", () => {
  function doorsHolding(held: readonly string[]) {
    const hasApiKeyPermission = vi.fn<AuthzApi["hasApiKeyPermission"]>(async ({ permission }) =>
      held.includes(permission),
    );
    const hasProjectPermission = vi.fn<AuthzApi["hasProjectPermission"]>(async ({ permission }) =>
      held.includes(permission),
    );
    const door = ApiDoorService.create({
      ...peers,
      authz: { ...peers.authz, hasApiKeyPermission, hasProjectPermission },
    }).door();

    return { identities: door.identities, hasApiKeyPermission, hasProjectPermission };
  }
  const asked = ["workflows:create", "evaluations:view"] as const;
  const keyRequest = () =>
    new Request("http://localhost/api/workflows/w/evaluate", {
      headers: { authorization: "Bearer sk-lw-owned", "x-project-id": "project-1" },
    });

  describe("given a project key holding every permission", () => {
    it("asks each in declared order and admits", async () => {
      const { identities, hasApiKeyPermission } = doorsHolding(asked);

      await identities.project.authenticate({
        request: keyRequest(),
        permission: asked[0],
        permissions: asked,
      });

      expect(hasApiKeyPermission.mock.calls.map(([input]) => input.permission)).toEqual(asked);
    });
  });

  describe("given a project key missing the second", () => {
    it("refuses api_key_permission_denied naming that permission", async () => {
      const { identities } = doorsHolding(["workflows:create"]);

      await expect(
        identities.project.authenticate({
          request: keyRequest(),
          permission: asked[0],
          permissions: asked,
        }),
      ).rejects.toMatchObject({
        code: "api_key_permission_denied",
        httpStatus: 403,
        meta: { permission: "evaluations:view" },
      });
    });
  });

  describe("given a person's CLI access token missing the first", () => {
    it("refuses on the first and never asks the second", async () => {
      const { identities, hasProjectPermission } = doorsHolding(["evaluations:view"]);

      await expect(
        identities.project.authenticate({
          request: new Request("http://localhost/api/x", {
            headers: { authorization: "Bearer lw_at_bound" },
          }),
          permission: asked[0],
          permissions: asked,
        }),
      ).rejects.toMatchObject({
        code: "api_key_permission_denied",
        meta: { permission: "workflows:create" },
      });
      expect(hasProjectPermission).toHaveBeenCalledTimes(1);
    });
  });

  describe("given an API key no user owns, bound to the project, starting a workflow run", () => {
    /** @scenario An evaluation run is judged against an API key's own bindings */
    it("asks authz about the key at that project with no user", async () => {
      const { identities, hasApiKeyPermission } = doorsHolding(asked);

      await identities.project.authenticate({
        request: new Request("http://localhost/api/workflows/w/evaluate", {
          headers: { authorization: "Bearer sk-lw-unowned", "x-project-id": "project-1" },
        }),
        permission: asked[0],
        permissions: asked,
      });

      expect(hasApiKeyPermission).toHaveBeenCalledWith({
        apiKeyId: "key-unowned",
        userId: null,
        organizationId: "org-1",
        scope: { type: "project", id: "project-1", teamId: "team-1" },
        permission: "evaluations:view",
      });
    });
  });

  describe("given a person's project-bound access token starting a workflow run", () => {
    /** @scenario An evaluation run started with a project-bound access token is judged as its person */
    it("asks authz about that person at that project, and no key id", async () => {
      const { identities, hasApiKeyPermission, hasProjectPermission } = doorsHolding(asked);

      await identities.project.authenticate({
        request: new Request("http://localhost/api/workflows/w/evaluate", {
          headers: { authorization: "Bearer lw_at_bound" },
        }),
        permission: asked[0],
        permissions: asked,
      });

      expect(hasProjectPermission).toHaveBeenCalledWith({
        userId: "user-3",
        projectId: "project-1",
        permission: "evaluations:view",
      });
      expect(hasApiKeyPermission).not.toHaveBeenCalled();
    });
  });

  describe("given an organization key missing the second", () => {
    it("refuses insufficient_permissions naming that permission", async () => {
      const { identities } = doorsHolding(["gatewaySpend:view"]);

      await expect(
        identities.organization.authenticate({
          request: new Request("http://localhost/api/x", {
            headers: { authorization: "Bearer sk-lw-org-owned" },
          }),
          permission: "gatewaySpend:view",
          permissions: ["gatewaySpend:view", "gatewaySpend:manage"],
        }),
      ).rejects.toMatchObject({
        code: "insufficient_permissions",
        httpStatus: 403,
        meta: { permission: "gatewaySpend:manage" },
      });
    });
  });

  describe("given any API key missing the second on the key door", () => {
    it("refuses permission_denied", async () => {
      const { identities } = doorsHolding(["virtualKeys:view"]);

      await expect(
        identities.api_key.authenticate({
          request: keyRequest(),
          permission: "virtualKeys:view",
          permissions: ["virtualKeys:view", "virtualKeys:manage"],
        }),
      ).rejects.toMatchObject({ code: "permission_denied", httpStatus: 403 });
    });
  });
});

describe("the project door's route-scoped question (E3)", () => {
  async function authorizeAt(projectId: string, holds: boolean) {
    const hasApiKeyPermission = vi.fn<AuthzApi["hasApiKeyPermission"]>(async () => holds);
    const { identities } = ApiDoorService.create({
      ...peers,
      authz: { ...peers.authz, hasApiKeyPermission },
    }).door();
    const caller = await identities.project.identify!({
      request: new Request("http://localhost/api/x", {
        headers: { authorization: "Bearer sk-lw-owned", "x-project-id": "project-1" },
      }),
    });

    return identities.project.authorize!({
      caller,
      permission: "workflows:view",
      target: { tier: "project", id: projectId },
    });
  }

  describe("given the key's own project and a ceiling holding the permission", () => {
    it("permits", async () => {
      await expect(authorizeAt("project-1", true)).resolves.toMatchObject({ permitted: true });
    });
  });

  describe("given the key's own project and a ceiling without it", () => {
    it("does not permit", async () => {
      await expect(authorizeAt("project-1", false)).resolves.toMatchObject({ permitted: false });
    });
  });

  describe("given another project", () => {
    it("does not permit, whatever the ceiling holds", async () => {
      await expect(authorizeAt("project-9", true)).resolves.toMatchObject({ permitted: false });
    });
  });

  describe("given a caller the door never resolved", () => {
    it("throws rather than answering", async () => {
      expect(() =>
        identities.project.authorize!({
          caller: { actor: null, scope: { tier: "project", id: "project-1" } },
          permission: "workflows:view",
          target: { tier: "project", id: "project-1" },
        }),
      ).toThrow("did not resolve");
    });
  });
});

describe("the organization door's route-scoped question at a team (H4)", () => {
  const teamOrganizations = new Map([
    ["team-a", "org-1"],
    ["team-b", "org-1"],
    ["team-foreign", "org-9"],
  ]);

  async function authorizeAt(teamId: string, grantedOn: readonly string[]) {
    const hasApiKeyPermission = vi.fn<AuthzApi["hasApiKeyPermission"]>(async ({ scope }) =>
      grantedOn.includes(scope.id),
    );
    const getScope: AuthzApi["getScope"] = async (ids) => {
      const organizationId = ids.teamId ? teamOrganizations.get(ids.teamId) : undefined;
      if (!ids.teamId || !organizationId) throw new AuthzScopeNotFoundError(ids);
      return { type: "team", id: ids.teamId, organizationId };
    };
    const { identities } = ApiDoorService.create({
      ...peers,
      authz: { ...peers.authz, hasApiKeyPermission, getScope },
    }).door();
    const caller = await identities.organization.identify!({
      request: new Request("http://localhost/api/teams/x", {
        headers: { authorization: "Bearer sk-lw-org-owned" },
      }),
    });
    const answer = identities.organization.authorize!({
      caller,
      permission: "team:manage",
      target: { tier: "team", id: teamId },
    });

    return { answer: Promise.resolve(answer), hasApiKeyPermission };
  }

  describe("given a key whose grant reaches the team it names", () => {
    it("permits, asking authz about the key at that team of its own organization", async () => {
      const { answer, hasApiKeyPermission } = await authorizeAt("team-a", ["team-a"]);

      await expect(answer).resolves.toMatchObject({ permitted: true });
      expect(hasApiKeyPermission).toHaveBeenCalledWith({
        apiKeyId: "key-org-owned",
        userId: "user-2",
        organizationId: "org-1",
        scope: { type: "team", id: "team-a" },
        permission: "team:manage",
      });
    });
  });

  describe("given a key whose grant covers one team and not the one it names", () => {
    it("does not permit", async () => {
      const { answer } = await authorizeAt("team-b", ["team-a"]);

      await expect(answer).resolves.toMatchObject({ permitted: false });
    });
  });

  describe("given a team of another organization", () => {
    it("answers team_not_found and never asks the key's grants", async () => {
      const { answer, hasApiKeyPermission } = await authorizeAt("team-foreign", ["team-foreign"]);

      await expect(answer).rejects.toMatchObject({ code: "team_not_found", httpStatus: 404 });
      expect(hasApiKeyPermission).not.toHaveBeenCalled();
    });
  });

  describe("given a team that does not exist", () => {
    it("answers team_not_found", async () => {
      const { answer } = await authorizeAt("team-missing", ["team-missing"]);

      await expect(answer).rejects.toMatchObject({ code: "team_not_found", httpStatus: 404 });
    });
  });
});

describe("the plan questions (E6)", () => {
  const plan = (type: string, webhookEndpointsEnabled: boolean): Plan => ({
    planSource: "license",
    type,
    name: type,
    free: false,
    maxMembers: 10,
    maxMembersLite: 10,
    maxMessagesPerMonth: 10,
    canPublish: true,
    webhookEndpointsEnabled,
    prices: { USD: 0, EUR: 0 },
  });
  function entitlementsOn(active: Plan) {
    return ApiDoorService.create({
      ...peers,
      entitlements: { getActivePlan: async () => active },
    }).door().entitlements;
  }
  const organization = { tier: "organization", id: "org-1" } as const;

  describe("given webhook_endpoints asked of a plan with the webhook platform", () => {
    it("holds, whatever the tier", async () => {
      await expect(
        entitlementsOn(plan("LAUNCH", true)).holds({
          entitlement: "webhook_endpoints",
          scope: organization,
        }),
      ).resolves.toBe(true);
    });
  });

  describe("given webhook_endpoints asked of an enterprise plan without it", () => {
    it("does not hold", async () => {
      await expect(
        entitlementsOn(plan("ENTERPRISE", false)).holds({
          entitlement: "webhook_endpoints",
          scope: organization,
        }),
      ).resolves.toBe(false);
    });

    it("refuses 403 forbidden with main's billing events message", () => {
      const refusal = entitlementsOn(plan("ENTERPRISE", false)).refusal?.({
        entitlement: "webhook_endpoints",
        feature: undefined,
      });

      expect(refusal).toBeInstanceOf(ForbiddenError);
      expect(refusal).toMatchObject({
        status: 403,
        message:
          "The billing events API is an enterprise feature; this organization's plan does not include it.",
      });
    });
  });

  describe("given enterprise asked", () => {
    it("holds on the enterprise tier alone", async () => {
      await expect(
        entitlementsOn(plan("ENTERPRISE", false)).holds({
          entitlement: "enterprise",
          scope: organization,
        }),
      ).resolves.toBe(true);
      await expect(
        entitlementsOn(plan("LAUNCH", true)).holds({
          entitlement: "enterprise",
          scope: organization,
        }),
      ).resolves.toBe(false);
    });

    it("refuses as an enterprise plan requirement naming the feature", () => {
      const refusal = entitlementsOn(plan("LAUNCH", true)).refusal?.({
        entitlement: "enterprise",
        feature: "Audit log export",
      });

      expect(refusal).toMatchObject({ code: "enterprise_plan_required" });
    });
  });
});

describe("the platform question", () => {
  function platformDoor(holds: boolean) {
    const can = vi.fn<AuthzApi["can"]>(async () => holds);
    const { authz } = ApiDoorService.create({ ...peers, authz: { ...peers.authz, can } }).door();

    return { authz, can };
  }

  describe("given an operator holding the platform grant", () => {
    it("asks authz for that person at the platform, and admits", async () => {
      const { authz, can } = platformDoor(true);

      await expect(
        authz.getPlatformDecision?.({ userId: "operator-1", permission: "ops:view" }),
      ).resolves.toEqual({ permitted: true });
      expect(can).toHaveBeenCalledWith({
        principal: { type: "user", id: "operator-1" },
        permission: "ops:view",
        scope: { type: "platform" },
      });
    });
  });

  describe("given a person without it", () => {
    it("answers not permitted", async () => {
      const { authz } = platformDoor(false);

      await expect(
        authz.getPlatformDecision?.({ userId: "user-1", permission: "ops:manage" }),
      ).resolves.toEqual({ permitted: false });
    });
  });
});

describe("the tRPC audit sink", () => {
  function auditedDoor() {
    const record = vi.fn<ApiDoorPeers["auditLog"]["record"]>(async () => ({
      id: "audit-1",
      occurredAt: 0,
    }));
    const getScope: AuthzApi["getScope"] = async (ids) => {
      if (ids.projectId === "project-1") {
        return { type: "project", id: "project-1", teamId: "team-1", organizationId: "org-1" };
      }
      if (ids.teamId === "team-1") return { type: "team", id: "team-1", organizationId: "org-1" };
      throw new AuthzScopeNotFoundError(ids);
    };
    const { audit } = ApiDoorService.create({
      ...peers,
      authz: { ...peers.authz, getScope },
      auditLog: { record },
    }).door();

    return { trpc: audit.trpc, record };
  }

  describe("given a project a row is audited against", () => {
    it("names the project's organization", async () => {
      const { trpc } = auditedDoor();

      await expect(trpc.organizationOf?.({ tier: "project", id: "project-1" })).resolves.toBe(
        "org-1",
      );
    });

    it("names no organization for a project it does not hold, rather than failing the call", async () => {
      const { trpc } = auditedDoor();

      await expect(trpc.organizationOf?.({ tier: "project", id: "project-gone" })).resolves.toBe(
        null,
      );
    });
  });

  describe("given a team a row is audited against", () => {
    it("names the team's organization", async () => {
      const { trpc } = auditedDoor();

      await expect(trpc.organizationOf?.({ tier: "team", id: "team-1" })).resolves.toBe("org-1");
    });
  });

  describe("given a row that names its target", () => {
    it("records the target and metadata beside the scope", async () => {
      const { trpc, record } = auditedDoor();

      await trpc.record({
        userId: "user-1",
        action: "traces.instantEval.enable",
        organizationId: "org-1",
        projectId: "project-1",
        targetKind: "organization",
        targetId: "org-1",
        metadata: { impersonatorId: "admin-1" },
      });

      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          projectId: "project-1",
          targetKind: "organization",
          targetId: "org-1",
          metadata: { impersonatorId: "admin-1" },
        }),
      );
    });
  });
});
