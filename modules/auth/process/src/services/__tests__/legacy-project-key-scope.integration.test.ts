/**
 * @vitest-environment node
 * A legacy project key through the real door and the REST runtime: ingestion, scope flags, full
 * access, and outside its scopes answered and logged, or refused once its project is enforced.
 * @see modules/auth/specs/legacy-project-key-scope.feature
 */
import { createErrorHandler } from "@langwatch/api";
import {
  LEGACY_PROJECT_KEY_SCOPE_FLAGS,
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
const PROMPTS_READ = "legacy_project_key_prompts_read";
const TRACES_READ = "legacy_project_key_traces_read";
const ANNOTATIONS_READ = "legacy_project_key_annotations_read";
const CONNECTED_AGENTS = "legacy_project_key_connected_agents";
const ENFORCED = "legacy_project_key_scope_enforced";

type Line = { level: "info" | "warn"; fields: Record<string, unknown>; message: string };

/** The real door over fixtures; `enabled` names the flags whose rule lists the project. */
function world({ enabled }: { enabled: readonly string[] }) {
  const lines: Line[] = [];
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
    legacyKeyLogger: {
      info: (fields: Record<string, unknown>, message: string) =>
        void lines.push({ level: "info", fields, message }),
      warn: (fields: Record<string, unknown>, message: string) =>
        void lines.push({ level: "warn", fields, message }),
    } as never,
  };

  return { door: ApiDoorService.create(peers).door(), flagReads, lines };
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
  "suiteArchive",
  "agents",
  "identified",
  "keyIdentified",
  "keyPrompts",
  "promptById",
  "annotations",
  "annotationsCreate",
  "annotationsManage",
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
  .withPermission("prompts:view", { legacyKey: PROMPTS_READ })
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.prompts())
  .post("/prompts/:promptId", "promptById")
  .keepsRecords()
  .withPermission("prompts:view")
  .withParams(z.object({ promptId: z.string() }))
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.promptById())
  .post("/traces", "traces")
  .keepsRecords()
  .withPermission("traces:view", { legacyKey: TRACES_READ })
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.traces())
  .post("/evaluations", "evaluations")
  .keepsRecords()
  .withPermission("evaluations:view", { legacyKey: "legacy_project_key_evaluations" })
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.evaluations())
  .post("/datasets", "datasets")
  .keepsRecords()
  .withPermission("datasets:view", { legacyKey: "legacy_project_key_experiments" })
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.datasets())
  .post("/prompts-update", "promptsUpdate")
  .keepsRecords()
  .withPermission("prompts:update", { legacyKey: "legacy_project_key_prompts_write" })
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.promptsUpdate())
  .post("/connect", "connect")
  .keepsRecords()
  .withPermission("scenarios:manage", { legacyKey: CONNECTED_AGENTS })
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.connect())
  .post("/model-providers", "modelProviders")
  .keepsRecords()
  .withPermission("project:view", { legacyKey: CONNECTED_AGENTS })
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.modelProviders())
  .post("/suite-archive", "suiteArchive")
  .keepsRecords()
  .withPermission("scenarios:manage")
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.suiteArchive())
  .post("/agents", "agents")
  .keepsRecords()
  .withPermission("project:view")
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.agents())
  .post("/identified", "identified")
  .keepsRecords()
  .withAccess(anyAuthenticated({ reason: "a test route that only identifies the caller" }))
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.identified())
  .post("/annotations", "annotations")
  .keepsRecords()
  .withPermission("annotations:view", { legacyKey: ANNOTATIONS_READ })
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.annotations())
  .post("/annotations-create", "annotationsCreate")
  .keepsRecords()
  .withPermission("annotations:create")
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.annotationsCreate())
  .post("/annotations-manage", "annotationsManage")
  .keepsRecords()
  .withPermission("annotations:manage")
  .withOutput(ANSWER)
  .withoutAudit("test route")
  .handle(({ app }) => app.annotationsManage())
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
  const { door, flagReads, lines } = world({ enabled });
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

  return { response, body, ran, flagReads, lines };
}

describe("a legacy project key on a project that is not enforced", () => {
  describe("when it calls a prompts route no flag opens for it", () => {
    /** @scenario "A legacy key on an unenforced project reaches a prompts route" */
    it("is answered, and logged outside its scopes with the route template", async () => {
      const { response, ran, lines } = await call({ enabled: [], path: "prompts" });

      expect(response.status).toBe(200);
      expect(ran).toEqual(["prompts"]);
      expect(lines).toEqual([
        expect.objectContaining({
          level: "warn",
          message: "legacy project key outside its scopes",
          fields: expect.objectContaining({
            projectId: "project-1",
            organizationId: "org-1",
            permission: "prompts:view",
            routeScopes: [PROMPTS_READ],
            enforced: false,
            route: expect.stringMatching(/^POST \/api\/legacy-scope\/.*prompts$/),
          }),
        }),
        expect.objectContaining({
          message: "legacy project key request",
          fields: expect.objectContaining({ grantedBy: "report_only" }),
        }),
      ]);
    });
  });

  describe("when it calls annotation routes on no flag", () => {
    /** @scenario "An unenforced project's legacy key on no flag still reads and writes annotations" */
    it.each([
      ["annotations", "annotations:view"],
      ["annotations-create", "annotations:create"],
      ["annotations-manage", "annotations:manage"],
    ] as const)("is answered at /%s and logged", async (path, permission) => {
      const { response, ran, lines } = await call({ enabled: [], path });

      expect(response.status).toBe(200);
      expect(ran).toEqual([path]);
      expect(lines[0]).toMatchObject({
        message: "legacy project key outside its scopes",
        fields: { permission, enforced: false },
      });
    });
  });

  describe("when it calls identify-only routes and the key door", () => {
    /** @scenario "An unenforced project's legacy key passes identify-only routes and the key door" */
    it.each([
      ["project", "identified", null],
      ["api_key", "identified", null],
      ["api_key", "prompts", "prompts:view"],
    ] as const)("is answered on the %s door at /%s and logged", async (door, path, permission) => {
      const { response, ran, lines } = await call({ enabled: [], door, path });

      expect(response.status).toBe(200);
      expect(ran).toEqual([path]);
      expect(lines[0]).toMatchObject({
        message: "legacy project key outside its scopes",
        fields: { permission, enforced: false },
      });
    });
  });

  describe("when it calls a route whose path carries an id and a query", () => {
    /** @scenario "The census line carries the route template and no token" */
    it("logs the method and path template, never the path, query or token", async () => {
      const { response, lines } = await call({
        enabled: [],
        path: "prompts/prompt_secret_id?filter=private",
      });

      expect(response.status).toBe(200);
      const census = lines.find((line) => line.message === "legacy project key request");
      expect(census?.fields.route).toMatch(/^POST \/api\/legacy-scope\/.*prompts\/:promptId$/);
      const written = JSON.stringify(lines);
      for (const leak of ["prompt_secret_id", "filter=private", "legacy-key"]) {
        expect(written).not.toContain(leak);
      }
    });
  });
});

describe("a legacy project key on an enforced project, not on the full-access flag", () => {
  describe("when it calls a route that asks traces:create", () => {
    /** @scenario "A legacy project key passes a route that asks traces:create" */
    it("is answered and never reads the flag", async () => {
      const { response, ran, flagReads } = await call({ enabled: [ENFORCED], path: "ingest" });

      expect(response.status).toBe(200);
      expect(ran).toEqual(["ingest"]);
      expect(flagReads).toEqual([]);
    });
  });

  describe("when it calls routes beyond ingestion", () => {
    /** @scenario "A legacy project key on an enforced project is refused prompts, traces, evaluations and datasets" */
    it.each(ASKED)("refuses %s with the ingestion-only code before any handler", async (asked) => {
      const { response, body, ran, lines } = await call({
        enabled: [ENFORCED],
        path: PATHS[asked]!,
      });

      expect(response.status).toBe(403);
      expect(body).toMatchObject({ code: "legacy_project_key_ingestion_only" });
      expect(JSON.stringify(body)).toContain(asked);
      expect(ran).toEqual([]);
      expect(lines).toEqual([
        expect.objectContaining({
          message: "legacy project key outside its scopes",
          fields: expect.objectContaining({ permission: asked, enforced: true }),
        }),
      ]);
    });
  });

  describe("when it calls a project route that asks no permission", () => {
    /** @scenario "A legacy project key on an enforced project is refused a route that asks no permission" */
    it("refuses with the ingestion-only code", async () => {
      const { response, body, ran } = await call({ enabled: [ENFORCED], path: "identified" });

      expect(response.status).toBe(403);
      expect(body).toMatchObject({ code: "legacy_project_key_ingestion_only" });
      expect(ran).toEqual([]);
    });
  });

  describe("when it calls the key door", () => {
    /** @scenario "A legacy project key on an enforced project is refused on the key door" */
    it.each(["identified", "prompts"])("refuses /%s with the ingestion-only code", async (path) => {
      const { response, body, ran } = await call({ enabled: [ENFORCED], door: "api_key", path });

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

async function refused(result: Awaited<ReturnType<typeof call>>) {
  expect(result.response.status).toBe(403);
  expect(result.body).toMatchObject({ code: "legacy_project_key_ingestion_only" });
  expect(result.ran).toEqual([]);
}

describe("a legacy project key on an enforced project with scope flags", () => {
  describe("given the prompts-read flag only", () => {
    const enabled = [PROMPTS_READ, ENFORCED];

    /** @scenario "An enforced project on the prompts-read flag reads prompts and nothing else" */
    it("fetches prompts and is refused trace reads and prompt writes", async () => {
      const prompts = await call({ enabled, path: "prompts" });
      expect(prompts.response.status).toBe(200);
      expect(prompts.ran).toEqual(["prompts"]);

      await refused(await call({ enabled, path: "traces" }));
      await refused(await call({ enabled, path: "prompts-update" }));
    });
  });

  describe("given the prompts-read and traces-read flags", () => {
    const enabled = [PROMPTS_READ, TRACES_READ, ENFORCED];

    /** @scenario "A project on two scope flags holds both" */
    it("holds both and is still refused evaluations", async () => {
      for (const path of ["prompts", "traces"]) {
        const { response } = await call({ enabled, path });
        expect(response.status).toBe(200);
      }
      await refused(await call({ enabled, path: "evaluations" }));
    });
  });

  describe("given the annotations-read flag only", () => {
    const enabled = [ANNOTATIONS_READ, ENFORCED];

    /** @scenario "The annotations-read flag opens annotation reads and no annotation writes" */
    it("reads annotations and is refused annotation writes", async () => {
      const reads = await call({ enabled, path: "annotations" });
      expect(reads.response.status).toBe(200);
      expect(reads.ran).toEqual(["annotations"]);
      expect(reads.lines).toEqual([
        expect.objectContaining({
          level: "info",
          fields: expect.objectContaining({ grantedBy: ANNOTATIONS_READ }),
        }),
      ]);

      await refused(await call({ enabled, path: "annotations-create" }));
      await refused(await call({ enabled, path: "annotations-manage" }));
      await refused(await call({ enabled, path: "traces" }));
    });
  });

  describe("given the connected-agents flag only", () => {
    const enabled = [CONNECTED_AGENTS, ENFORCED];

    /** @scenario "The connected-agents flag opens the connect routes and the model providers read only" */
    it("connects and reads model providers, and is refused suite archive and the agents list", async () => {
      for (const path of ["connect", "model-providers"]) {
        const { response, ran } = await call({ enabled, path });
        expect(response.status).toBe(200);
        expect(ran).toEqual([path]);
      }
      await refused(await call({ enabled, path: "suite-archive" }));
      await refused(await call({ enabled, path: "agents" }));
      await refused(await call({ enabled, path: "prompts" }));
    });

    /** @scenario "The connect socket's door admits a legacy key on the connected-agents flag" */
    it("is admitted by the socket door only with the scope the socket names", async () => {
      const { door } = world({ enabled });
      const ask = (legacyKeyScopes?: readonly string[]) =>
        door.identities.project.authenticate({
          request: new Request("http://localhost/api/v1/agents/connect", {
            headers: { "x-auth-token": "legacy-key" },
          }),
          permission: "scenarios:manage",
          permissions: ["scenarios:manage"],
          keyKinds: ["api_key", "legacy_project_key"],
          ...(legacyKeyScopes ? { legacyKeyScopes } : {}),
        });

      await expect(ask([CONNECTED_AGENTS])).resolves.toMatchObject({
        scope: { tier: "project", id: "project-1" },
      });
      await expect(ask()).rejects.toMatchObject({ code: "legacy_project_key_ingestion_only" });
    });
  });

  describe("given every scope flag but not full access", () => {
    /** @scenario "A scope flag does not open a route that asks no permission" */
    it.each([
      ["project", "identified"],
      ["api_key", "identified"],
      ["api_key", "prompts"],
    ] as const)("is refused on the %s door at /%s", async (door, path) => {
      const result = await call({
        enabled: [...LEGACY_PROJECT_KEY_SCOPE_FLAGS, ENFORCED],
        door,
        path,
      });

      expect(result.response.status).toBe(403);
      await refused(result);
    });
  });

  describe("given a route that names an unknown scope flag", () => {
    /** @scenario "A route naming an unknown scope flag is refused" */
    it("fails to mount behind the real project door", () => {
      const { door } = world({ enabled: [] });
      const typo = defineRestRouter(ProbeApi)
        .withNamespace("legacy-scope-typo")
        .withVersion(VERSION)
        .post("/prompts", "prompts")
        .keepsRecords()
        .withPermission("prompts:view", { legacyKey: "legacy_project_key_everything" })
        .withOutput(ANSWER)
        .withoutAudit("test route")
        .handle(({ app }) => app.prompts())
        .build()
        .router();

      expect(() =>
        createRestRuntime({
          authorization: { forRequest: () => door.authz },
          identity: door.identities.project,
        }).mount(typo, { app: () => ({}) as ProbeApi, onError: createErrorHandler() }),
      ).toThrow(/legacy_project_key_everything/);
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
