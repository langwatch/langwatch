/**
 * Keys created before keys had owners keep main's trace reads: a legacy project key or an
 * ownerless API key reads its own project's traces on an own-only proof, through the real door
 * and the real REST runtime. Any other internal or system actor is refused.
 */
import type {
  ApiKeyTokenResolutionInput,
  ResolvedApiKeyCredential,
} from "@langwatch/api-key-contract";
import { createErrorHandler } from "@langwatch/api";
import {
  createRestRuntime,
  defineRestRouter,
  OWNERLESS_PROJECT_KEY_PROOF_CODE_PATH,
} from "@langwatch/api/rest";
import { internalActor, sealAuthorization } from "@langwatch/authorization";
import { AuthzScopeNotFoundError, type AuthzApi } from "@langwatch/authz-contract";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ApiDoorService, type ApiDoorPeers } from "../api-door.service.ts";

const PROJECT = {
  id: "project-1",
  name: "Project",
  slug: "project",
  teamId: "team-1",
  organizationId: "org-1",
  isPersonal: false,
  ownerUserId: null,
  kind: "application",
};

function projectKey(apiKeyId: string): Extract<ResolvedApiKeyCredential, { type: "apiKey" }> {
  return {
    type: "apiKey",
    apiKeyId,
    userId: null,
    organizationId: "org-1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    project: PROJECT,
  };
}

/** Main's legacy key is its project; a project-bound key resolves only at its own project. */
const tokens = new Map<string, ResolvedApiKeyCredential>([
  ["sk-lw-legacy", { type: "legacyProjectKey", project: PROJECT }],
  ["sk-lw-ownerless", projectKey("key-ownerless")],
  ["sk-lw-unattended-run", { ...projectKey("key-run"), isUnattendedRunKey: true }],
]);

const refuseEverything = () => Promise.reject(new Error("this read asks nothing of it"));

type Internal = Parameters<AuthzApi["authorizeInternal"]>[0];

function world() {
  const internal: Internal[] = [];
  const getScope: AuthzApi["getScope"] = async (ids) => {
    if (ids.projectId === "project-1") {
      return { type: "project", id: "project-1", teamId: "team-1", organizationId: "org-1" };
    }
    throw new AuthzScopeNotFoundError(ids);
  };
  const peers: ApiDoorPeers = {
    sessions: { verifyBrowserSession: refuseEverything, resolveBrowserSession: refuseEverything },
    twoStep: { offersTwoStepVerification: () => false },
    identity: { getOrganizationMfaStanding: refuseEverything },
    apiKeys: {
      getOrgProjects: () => Promise.resolve([]),
      findResolvedToken: ({ token, projectId }: ApiKeyTokenResolutionInput) => {
        const resolved = tokens.get(token) ?? null;
        const elsewhere = resolved?.type === "apiKey" && projectId && projectId !== PROJECT.id;
        return Promise.resolve(elsewhere ? null : resolved);
      },
      resolveOrganizationToken: () =>
        Promise.resolve({ ok: false, reason: "unusable_credential" } as const),
      markUsed: () => {},
    },
    cliProjects: { getCliAccessProject: refuseEverything },
    authz: {
      hasApiKeyPermission: async () => true,
      hasProjectPermission: refuseEverything,
      getApiKeyProjectDecision: refuseEverything,
      listApiKeyBindings: refuseEverything,
      getDecision: refuseEverything,
      getProjectAnyDecision: refuseEverything,
      checkScopeLineage: async () => ({ kind: "consistent" }),
      getSessionVersion: refuseEverything,
      getScope,
      can: refuseEverything,
      authorize: refuseEverything,
      authorizeInternal: async (input) => {
        internal.push(input);
        return sealAuthorization({
          actor: input.actor,
          principal: { type: "internal", codePath: OWNERLESS_PROJECT_KEY_PROOF_CODE_PATH },
          scope: { organizationId: "org-1" },
          grants: [
            { projectId: input.projectId, permissions: [input.permission], via: [], kind: "own" },
          ],
          expiresAt: Number.MAX_SAFE_INTEGER,
          purpose: input.purpose,
        });
      },
    },
    organizations: {
      getSettings: refuseEverything,
      getOrganizationIdByTeamId: refuseEverything,
      findPersonalTeamOwners: refuseEverything,
    },
    entitlements: { getActivePlan: refuseEverything },
    auditLog: { record: refuseEverything },
  };

  return { door: ApiDoorService.create(peers).door(), internal };
}

type TracesApi = { search(): Promise<{ read: boolean }> };

const TracesApi = moduleApi<TracesApi>()("trace");
const VERSION = "2026-10-09";

const routes = defineRestRouter(TracesApi)
  .withNamespace("traces-legacy-keys")
  .withVersion(VERSION)
  .post("/search", "search")
  .withPermission("traces:view")
  .withOutput(z.object({ read: z.boolean() }))
  .handle(({ app }) => app.search())
  .build()
  .router();

async function search(headers: Record<string, string>) {
  const { door, internal } = world();
  const ran: string[] = [];
  const app: TracesApi = {
    search: async () => {
      ran.push("search");
      return { read: true };
    },
  };
  const response = await createRestRuntime({
    authorization: { forRequest: () => door.authz },
    identity: door.identities.project,
  })
    .mount(routes, { app: () => app, onError: createErrorHandler() })
    .request(`/api/traces-legacy-keys/${VERSION}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: "{}",
    });

  return { response, internal, ran };
}

const OWN_READ = {
  actor: internalActor(OWNERLESS_PROJECT_KEY_PROOF_CODE_PATH),
  projectId: "project-1",
  permission: "traces:view",
};

describe("a trace search with a key created on main", () => {
  describe("given a legacy project key", () => {
    /** @scenario "A legacy project key reads its own project's traces" */
    it("reads its own project's traces on an own-only proof", async () => {
      const { response, internal, ran } = await search({ "x-auth-token": "sk-lw-legacy" });

      expect(response.status).toBe(200);
      expect(internal).toEqual([expect.objectContaining(OWN_READ)]);
      expect(ran).toEqual(["search"]);
    });

    /** @scenario "A legacy project key reads its own project's traces" */
    it("still reads only its own project when it names another", async () => {
      const { internal } = await search({
        "x-auth-token": "sk-lw-legacy",
        "x-project-id": "project-2",
      });

      expect(internal.map(({ projectId }) => projectId)).toEqual(["project-1"]);
    });
  });

  describe("given an API key no person owns", () => {
    /** @scenario "An API key with no owner reads its own project's traces" */
    it("reads its own project's traces on an own-only proof", async () => {
      const { response, internal } = await search({
        authorization: "Bearer sk-lw-ownerless",
        "x-project-id": "project-1",
      });

      expect(response.status).toBe(200);
      expect(internal).toEqual([expect.objectContaining(OWN_READ)]);
    });

    /** @scenario "An API key with no owner reads its own project's traces" */
    it("is refused at another project, and nothing is read", async () => {
      const { response, internal, ran } = await search({
        authorization: "Bearer sk-lw-ownerless",
        "x-project-id": "project-2",
      });

      expect(response.status).toBe(401);
      expect(internal).toEqual([]);
      expect(ran).toEqual([]);
    });
  });

  describe("given the key of a run nobody started", () => {
    /** @scenario "A run nobody started is refused a trace read cleanly" */
    it("answers 403 permission_denied rather than failing", async () => {
      const { response, internal, ran } = await search({
        authorization: "Bearer sk-lw-unattended-run",
        "x-project-id": "project-1",
      });

      expect(response.status).toBe(403);
      expect(await response.text()).toContain("permission_denied");
      expect(internal).toEqual([]);
      expect(ran).toEqual([]);
    });
  });
});

describe("the door's proof for an internal actor", () => {
  it("refuses any code path but the ownerless key's own", async () => {
    const { door, internal } = world();

    await expect(
      door.authz.authorization({
        actor: internalActor("somewhere-else"),
        permission: "traces:view",
        projectId: "project-1",
        purpose: { kind: "route", route: "trace.search" },
      }),
    ).rejects.toThrow("reached a door that mints a route proof");
    expect(internal).toEqual([]);
  });
});
