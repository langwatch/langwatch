/**
 * Every key door hands its caller the key's owning user, and no actor for a key no person
 * owns (ARCHITECTURE §8).
 */
import type {
  ApiKeyTokenResolutionInput,
  OrganizationApiKeyResolution,
  ResolvedApiKeyCredential,
} from "@langwatch/api-key-contract";
import type { RestIdentity } from "@langwatch/api/rest";
import { describe, expect, it } from "vitest";

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
  authz: {
    hasApiKeyPermission: refuseEverything,
    getApiKeyProjectDecision: refuseEverything,
    getDecision: refuseEverything,
    getProjectAnyDecision: refuseEverything,
    checkScopeLineage: refuseEverything,
    getSessionVersion: refuseEverything,
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
      expect(await actorThrough(identities.apiKey, headers)).toEqual({
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
      expect(await actorThrough(identities.apiKey, headers)).toBeNull();
    });
  });

  /** @scenario "A run nobody started acts as the system actor at the door" */
  describe("given the key of a run nobody started", () => {
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
