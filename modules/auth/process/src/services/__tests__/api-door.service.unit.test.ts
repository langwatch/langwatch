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
import { AuthzScopeNotFoundError, type AuthzApi } from "@langwatch/authz-contract";
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
