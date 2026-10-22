/**
 * @vitest-environment node
 * A legacy project key through the real door and the real REST runtime: it sends traces, holds
 * what its project's scope flags grant, and keeps full access only on
 * `legacy_project_key_full_access`.
 * @see modules/auth/specs/legacy-project-key-scope.feature
 */
import { createErrorHandler } from "@langwatch/api";
import {
  LEGACY_PROJECT_KEY_SCOPES,
  type ApiKeyTokenResolutionInput,
  type ResolvedApiKeyCredential,
} from "@langwatch/api-key-contract";
import { anyAuthenticated } from "@langwatch/api/access";
import {
  createRestRuntime,
  defineRestRouter,
  OWNERLESS_PROJECT_KEY_PROOF_CODE_PATH,
} from "@langwatch/api/rest";
import { sealAuthorization, type AuthzPermission } from "@langwatch/authorization";
import { AuthzScopeNotFoundError, type AuthzApi } from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { moduleApi } from "@langwatch/module";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
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

const tokens = new Map<string, ResolvedApiKeyCredential>([
  ["legacy-key", { type: "legacyProjectKey", project: PROJECT }],
  [
    "sk-lw-ownerless",
    {
      type: "apiKey",
      apiKeyId: "key-ownerless",
      userId: null,
      organizationId: "org-1",
      ingestSourceType: null,
      ingestionTemplateId: null,
      project: PROJECT,
    },
  ],
]);

const refuseEverything = () => Promise.reject(new Error("this request asks nothing of it"));

type FlagRead = Parameters<FeatureFlagApi["isEnabled"]>;

const FULL_ACCESS = "legacy_project_key_full_access";
const EVERY_SCOPE = Object.keys(LEGACY_PROJECT_KEY_SCOPES);

/** The real door over fixtures; `enabled` names the flags whose rule lists the project. */
function world({ enabled }: { enabled: readonly string[] }) {
  const flagReads: FlagRead[] = [];
  const featureFlags = createApiFixture<FeatureFlagApi>({
    isEnabled: async (...read) => {
      flagReads.push(read);
      return enabled.includes(read[0]);
    },
  });
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
      findResolvedToken: ({ token }: ApiKeyTokenResolutionInput) =>
        Promise.resolve(tokens.get(token) ?? null),
      resolveOrganizationToken: () =>
        Promise.resolve({ ok: false, reason: "unusable_credential" } as const),
      markUsed: () => {},
    },
    featureFlags,
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
      authorizeInternal: async (input) =>
        sealAuthorization({
          actor: input.actor,
          principal: { type: "internal", codePath: OWNERLESS_PROJECT_KEY_PROOF_CODE_PATH },
          scope: { organizationId: "org-1" },
          grants: [
            { projectId: input.projectId, permissions: [input.permission], via: [], kind: "own" },
          ],
          expiresAt: Number.MAX_SAFE_INTEGER,
          purpose: input.purpose,
        }),
    },
    organizations: {
      getSettings: refuseEverything,
      getOrganizationIdByTeamId: refuseEverything,
      findPersonalTeamOwners: refuseEverything,
    },
    entitlements: { getActivePlan: refuseEverything },
    auditLog: { record: refuseEverything },
  };

  return { door: ApiDoorService.create(peers).door(), flagReads };
}

const OPERATIONS = [
  "ingest",
  "prompts",
  "traces",
  "evaluations",
  "datasets",
  "promptsUpdate",
  "connect",
  "modelProviders",
  "identified",
  "keyIdentified",
  "keyPrompts",
] as const;
type Operation = (typeof OPERATIONS)[number];
type ProbeApi = Record<Operation, () => Promise<{ ok: boolean }>>;
const ProbeApi = moduleApi<ProbeApi>()("trace");
const VERSION = "2026-10-22";
const ANSWER = z.object({ ok: z.boolean() });
const ASKED: readonly AuthzPermission[] = [
  "prompts:view",
  "traces:view",
  "evaluations:view",
  "datasets:view",
];

const projectRoutes = defineRestRouter(ProbeApi)
  .withNamespace("legacy-scope")
  .withVersion(VERSION)
  .post("/ingest", "ingest")
  .keepsRecords()
  .withPermission("traces:create")
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.ingest())
  .post("/prompts", "prompts")
  .keepsRecords()
  .withPermission("prompts:view")
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.prompts())
  .post("/traces", "traces")
  .keepsRecords()
  .withPermission("traces:view")
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.traces())
  .post("/evaluations", "evaluations")
  .keepsRecords()
  .withPermission("evaluations:view")
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.evaluations())
  .post("/datasets", "datasets")
  .keepsRecords()
  .withPermission("datasets:view")
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.datasets())
  .post("/prompts-update", "promptsUpdate")
  .keepsRecords()
  .withPermission("prompts:update")
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.promptsUpdate())
  .post("/connect", "connect")
  .keepsRecords()
  .withPermission("scenarios:manage")
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.connect())
  .post("/model-providers", "modelProviders")
  .keepsRecords()
  .withPermission("project:view")
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.modelProviders())
  .post("/identified", "identified")
  .keepsRecords()
  .withAccess(anyAuthenticated({ reason: "a test route that only identifies the caller" }))
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.identified())
  .build()
  .router();

const keyRoutes = defineRestRouter(ProbeApi)
  .withNamespace("legacy-scope-keys")
  .withVersion(VERSION)
  .withCredential("api_key")
  .post("/identified", "keyIdentified")
  .keepsRecords()
  .withAccess(anyAuthenticated({ reason: "a test route that only identifies the key" }))
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.keyIdentified())
  .post("/prompts", "keyPrompts")
  .keepsRecords()
  .withPermission("prompts:view")
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.keyPrompts())
  .build()
  .router();

const PATHS: Record<string, string> = {
  "traces:create": "ingest",
  "prompts:view": "prompts",
  "traces:view": "traces",
  "evaluations:view": "evaluations",
  "datasets:view": "datasets",
  "prompts:update": "prompts-update",
  "scenarios:manage": "connect",
  "project:view": "model-providers",
};

async function call({
  enabled,
  door: which = "project",
  path,
  token = "legacy-key",
}: {
  enabled: readonly string[];
  door?: "project" | "api_key";
  path: string;
  token?: string;
}) {
  const { door, flagReads } = world({ enabled });
  const ran: string[] = [];
  const app = Object.fromEntries(
    OPERATIONS.map((operation) => [
      operation,
      async () => {
        ran.push(path);
        return { ok: true };
      },
    ]),
  ) as ProbeApi;
  const namespace = which === "project" ? "legacy-scope" : "legacy-scope-keys";
  const response = await createRestRuntime({
    authorization: { forRequest: () => door.authz },
    identity: which === "project" ? door.identities.project : door.identities.api_key,
  })
    .mount(which === "project" ? projectRoutes : keyRoutes, {
      app: () => app,
      onError: createErrorHandler(),
    })
    .request(`/api/${namespace}/${VERSION}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-auth-token": token },
      body: "{}",
    });
  const body: unknown = response.status === 200 ? null : await response.json();

  return { response, body, ran, flagReads };
}

describe("a legacy project key whose project is not on the full-access flag", () => {
  describe("when it calls a route that asks traces:create", () => {
    /** @scenario "A legacy project key passes a route that asks traces:create" */
    it("is answered and never reads the flag", async () => {
      const { response, ran, flagReads } = await call({ enabled: [], path: "ingest" });

      expect(response.status).toBe(200);
      expect(ran).toEqual(["ingest"]);
      expect(flagReads).toEqual([]);
    });
  });

  describe("when it calls routes beyond ingestion", () => {
    /** @scenario "A legacy project key is refused prompts, traces, evaluations and datasets" */
    it.each(ASKED)("refuses %s with the ingestion-only code before any handler", async (asked) => {
      const { response, body, ran } = await call({ enabled: [], path: PATHS[asked]! });

      expect(response.status).toBe(403);
      expect(body).toMatchObject({ code: "legacy_project_key_ingestion_only" });
      expect(JSON.stringify(body)).toContain(asked);
      expect(ran).toEqual([]);
    });
  });

  describe("when it calls a project route that asks no permission", () => {
    /** @scenario "A legacy project key is refused a project route that asks no permission" */
    it("refuses with the ingestion-only code", async () => {
      const { response, body, ran } = await call({ enabled: [], path: "identified" });

      expect(response.status).toBe(403);
      expect(body).toMatchObject({ code: "legacy_project_key_ingestion_only" });
      expect(ran).toEqual([]);
    });
  });

  describe("when it calls the key door", () => {
    /** @scenario "A legacy project key is refused on the key door" */
    it.each(["identified", "prompts"])("refuses /%s with the ingestion-only code", async (path) => {
      const { response, body, ran } = await call({ enabled: [], door: "api_key", path });

      expect(response.status).toBe(403);
      expect(body).toMatchObject({ code: "legacy_project_key_ingestion_only" });
      expect(ran).toEqual([]);
    });
  });
});

describe("a legacy project key whose project is on the full-access flag", () => {
  /** @scenario "A legacy project key on the full-access flag keeps full access" */
  it.each([
    ["project", "prompts"],
    ["project", "evaluations"],
    ["project", "identified"],
    ["api_key", "identified"],
    ["api_key", "prompts"],
  ] as const)("is answered on the %s door at /%s", async (door, path) => {
    const { response, ran } = await call({ enabled: [FULL_ACCESS], door, path });

    expect(response.status).toBe(200);
    expect(ran).toEqual([path]);
  });
});

describe("a legacy project key whose project is on scope flags", () => {
  describe("given the prompts-read flag only", () => {
    const enabled = ["legacy_project_key_prompts_read"];

    /** @scenario "A project on the prompts-read flag fetches prompts and nothing else" */
    it("fetches prompts and is refused trace reads and prompt writes", async () => {
      const prompts = await call({ enabled, path: "prompts" });
      expect(prompts.response.status).toBe(200);
      expect(prompts.ran).toEqual(["prompts"]);

      for (const path of ["traces", "prompts-update"]) {
        const { response, body, ran } = await call({ enabled, path });
        expect(response.status).toBe(403);
        expect(body).toMatchObject({ code: "legacy_project_key_ingestion_only" });
        expect(ran).toEqual([]);
      }
    });

    /** @scenario "A scope flag is honoured on the key door" */
    it("fetches prompts on the key door", async () => {
      const { response, ran } = await call({ enabled, door: "api_key", path: "prompts" });

      expect(response.status).toBe(200);
      expect(ran).toEqual(["prompts"]);
    });
  });

  describe("given the prompts-read and traces-read flags", () => {
    const enabled = ["legacy_project_key_prompts_read", "legacy_project_key_traces_read"];

    /** @scenario "A project on two scope flags holds both" */
    it("holds both and is still refused evaluations", async () => {
      for (const path of ["prompts", "traces"]) {
        const { response } = await call({ enabled, path });
        expect(response.status).toBe(200);
      }
      const { response, body } = await call({ enabled, path: "evaluations" });
      expect(response.status).toBe(403);
      expect(body).toMatchObject({ code: "legacy_project_key_ingestion_only" });
    });
  });

  describe("given the connected-agents flag only", () => {
    const enabled = ["legacy_project_key_connected_agents"];

    /** @scenario "The connected-agents flag opens connecting and model providers only" */
    it("connects and reads model providers, and is refused prompts", async () => {
      for (const path of ["connect", "model-providers"]) {
        const { response, ran } = await call({ enabled, path });
        expect(response.status).toBe(200);
        expect(ran).toEqual([path]);
      }
      const { response, body } = await call({ enabled, path: "prompts" });
      expect(response.status).toBe(403);
      expect(body).toMatchObject({ code: "legacy_project_key_ingestion_only" });
    });
  });

  describe("given every scope flag but not full access", () => {
    /** @scenario "A scope flag does not open a route that asks no permission" */
    it.each([
      ["project", "identified"],
      ["api_key", "identified"],
    ] as const)("is refused on the %s door at /%s", async (door, path) => {
      const { response, body, ran } = await call({ enabled: EVERY_SCOPE, door, path });

      expect(response.status).toBe(403);
      expect(body).toMatchObject({ code: "legacy_project_key_ingestion_only" });
      expect(ran).toEqual([]);
    });
  });
});

describe("other credentials", () => {
  describe("given a token that resolves to no key", () => {
    /** @scenario "An unknown key is still refused as invalid credentials" */
    it("is refused as invalid credentials", async () => {
      const { response, body } = await call({
        enabled: [],
        path: "prompts",
        token: "nothing",
      });

      expect(response.status).toBe(401);
      expect(body).toMatchObject({ code: "invalid_credentials" });
    });
  });

  describe("given an API key whose ceiling holds the permission", () => {
    /** @scenario "An API key is still asked its own ceiling" */
    it("is answered without reading the flag", async () => {
      const { response, flagReads } = await call({
        enabled: [],
        path: "prompts",
        token: "sk-lw-ownerless",
      });

      expect(response.status).toBe(200);
      expect(flagReads).toEqual([]);
    });
  });
});
