/**
 * The platform family's virtual-key create over the real application on its memory twins: the
 * route declares the wire, the service the mint and the authorization asks what the credential
 * holds, so each refusal is the production one.
 * @vitest-environment node
 * @see specs/ai-gateway/public-rest-api.feature
 */
import { ProjectMissingCredentialsError } from "@langwatch/api";
import {
  bindRestMiddleware,
  canonicalErrorResponse,
  createRestRuntime,
  type IdempotentRunner,
} from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { GatewayVirtualKeyCaller } from "@langwatch/gateway-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SecretApi, StashRevealInput } from "@langwatch/secret-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { GatewayModule } from "../../app/gateway.app.ts";
import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import { MemoryGatewayStore } from "../../repositories/memory/memory.gateway.store.ts";
import {
  gatewayKeyCaller,
  gatewayPlatformRest,
  gatewayRestCredential,
  gatewayVirtualKeyCaller,
} from "../gateway-platform.rest.ts";

const ORGANIZATION_ID = "org_1";
const OWN_PROJECT = "project_1";
const SIBLING_PROJECT = "project_2";
const OTHER_TEAM_PROJECT = "project_3";
const PROJECT_TEAMS = new Map([
  [OWN_PROJECT, "team_1"],
  [SIBLING_PROJECT, "team_1"],
  [OTHER_TEAM_PROJECT, "team_2"],
]);

const secrets = new ScopedSecrets(async (handle, build) =>
  build(handle.id === "LW_VIRTUAL_KEY_PEPPER" ? "test-virtual-key-pepper" : undefined),
);

const keyWire = z.looseObject({
  id: z.string(),
  name: z.string(),
  purpose: z.string(),
  routing_mode: z.string(),
  trace_project_id: z.string().nullable(),
  external_id: z.string().nullable(),
  scopes: z.array(z.object({ scope_type: z.string(), scope_id: z.string() })),
  config: z.looseObject({}),
});
const wire = z.looseObject({
  secret: z.string().optional(),
  virtual_key: keyWire.optional(),
  data: z.array(keyWire).optional(),
  type: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  meta: z.unknown().optional(),
  error: z.looseObject({ code: z.string().optional(), type: z.string().optional() }).optional(),
});

const passthroughIdempotency: IdempotentRunner = async ({ handler }) => {
  const response = await handler();
  return { isReplayed: false, status: response.status, response };
};

type Credential =
  | { kind: "project" }
  | { kind: "apiKey"; holds: (input: { permission: string; scopeId: string }) => boolean };

/** The credential is what the route's caller fact names; the grants are what authz answers. */
async function mountedCreate(
  credential: Credential,
  { oneTimeReveals }: { oneTimeReveals?: SecretApi } = {},
) {
  const store = MemoryGatewayStore.create({
    teams: [
      { id: "team_1", organizationId: ORGANIZATION_ID, name: "Platform", slug: "platform" },
      { id: "team_2", organizationId: ORGANIZATION_ID, name: "Data", slug: "data" },
    ],
  });
  const { repositories } = new MemoryGatewayRepositories(store);
  const identity = (id: string) => {
    const teamId = PROJECT_TEAMS.get(id);
    return teamId === undefined
      ? null
      : {
          id,
          name: id,
          slug: id,
          teamId,
          organizationId: ORGANIZATION_ID,
          isPersonal: false,
          ownerUserId: null,
        };
  };
  const app = await GatewayModule.create({
    dependencies: {
      authz: createApiFixture<AuthzApi>({
        hasApiKeyPermission: async (input) =>
          credential.kind === "apiKey" &&
          credential.holds({
            permission: input.permission,
            scopeId: input.scope.id,
          }),
      }),
      projects: createApiFixture<ProjectApi>({
        findOrganizationId: async () => ORGANIZATION_ID,
        findIdentity: async (id) => identity(id),
        listIdsByOrganization: async () => [...PROJECT_TEAMS.keys()],
        listTraceDestinations: async (projectIds) =>
          projectIds.map((id) => ({ id, teamId: PROJECT_TEAMS.get(id) ?? "", archivedAt: null })),
        resolveTraceDestination: async ({ projectScopeIds, traceProjectId }) => {
          const id = traceProjectId ?? (projectScopeIds.length === 1 ? projectScopeIds[0] : null);
          const teamId = id === null || id === undefined ? undefined : PROJECT_TEAMS.get(id);
          return id && teamId
            ? { outcome: "resolved", project: { id, teamId, archivedAt: null } }
            : { outcome: "no_destination" };
        },
      }),
      evaluators: createApiFixture({}),
      evaluations: createApiFixture({}),
      monitors: createApiFixture({}),
      organizations: createApiFixture({}),
      featureFlags: createApiFixture({}),
      modelProviders: createApiFixture({}),
      traces: createApiFixture({}),
      oneTimeReveals: oneTimeReveals ?? createApiFixture({}),
      apiKeys: createApiFixture({}),
    },
    repositories,
    config: {
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      publicBaseUrl: "https://app.acme.example",
      baseUrl: void 0,
      publicUrl: void 0,
      isSaas: false,
      allowLoopbackVoiceProviders: false,
    },
    resources: new ResourceScope(),
    secrets,
  });
  const caller: GatewayVirtualKeyCaller =
    credential.kind === "project"
      ? { kind: "project", projectId: OWN_PROJECT }
      : {
          kind: "apiKey",
          apiKeyId: "api_key_1",
          userId: "user_1",
          organizationId: ORGANIZATION_ID,
          resolvedProject: { id: OWN_PROJECT, teamId: "team_1" },
        };
  const door = ({ request }: { request: Request }) => {
    if (!request.headers.get("Authorization")) throw new ProjectMissingCredentialsError();
    return {
      actor: { type: "api_key" as const, id: "gateway-key" },
      scope: { tier: "organization" as const, id: ORGANIZATION_ID },
    };
  };
  const runtime = createRestRuntime({
    identity: { authenticate: door, identify: door },
    doors: { api_key: { authenticate: door, identify: door } },
    idempotency: passthroughIdempotency,
  });
  const hono = runtime.mount(gatewayPlatformRest.router(), {
    app: () => app,
    onError: canonicalErrorResponse,
    facts: [
      bindRestMiddleware(gatewayRestCredential, () => ({ kind: "legacyProjectKey" as const })),
      bindRestMiddleware(gatewayKeyCaller, () => caller),
      bindRestMiddleware(gatewayVirtualKeyCaller, () => caller),
    ],
  });
  const call = async (
    method: string,
    path: string,
    init: { body?: unknown; anonymous?: boolean } = {},
  ) => {
    const response = await hono.request(`/api/gateway/v1${path}`, {
      method,
      headers: {
        ...(init.anonymous ? {} : { Authorization: "Bearer sk-lw-test" }),
        "Content-Type": "application/json",
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const text = await response.text();
    return { status: response.status, text, body: wire.parse(JSON.parse(text)) };
  };
  return { call };
}

const holdsEverything: Credential = { kind: "apiKey", holds: () => true };
const langySession: Credential = {
  kind: "apiKey",
  holds: ({ permission, scopeId }) =>
    permission === "virtualKeys:create" && scopeId === OWN_PROJECT,
};

describe("the platform family's virtual-key create", () => {
  describe("given a create that asks for reveal_once", () => {
    /** @scenario "The REST create with reveal_once answers with the reveal id and the prefix, not the secret" */
    it("answers the key, its prefix and a reveal id, and parks the secret for that id", async () => {
      const stashed: StashRevealInput[] = [];
      const { call } = await mountedCreate(
        { kind: "project" },
        {
          oneTimeReveals: createApiFixture<SecretApi>({
            stashReveal: async (input) => {
              stashed.push(input);
              return { revealId: "rvl_content_marker" };
            },
          }),
        },
      );

      const created = await call("POST", "/virtual-keys", {
        body: { name: "production-app", reveal_once: true },
      });

      expect(created.status).toBe(201);
      expect(created.body.virtual_key).toMatchObject({ name: "production-app" });
      expect(created.body).toMatchObject({ reveal_id: "rvl_content_marker" });
      expect(created.body.secret).toBeUndefined();
      expect(stashed).toHaveLength(1);
      const [parked] = stashed;
      expect(parked).toMatchObject({
        organizationId: ORGANIZATION_ID,
        kind: "virtual_key",
        keyId: created.body.virtual_key?.id,
        preview: (created.body as { preview?: string }).preview,
      });
      expect(parked?.secret).toMatch(/^vk-lw-/);
      expect(created.text).not.toContain(parked?.secret ?? "no secret was parked");
    });
  });

  describe("given a project key", () => {
    /** @scenario Create a virtual key with the SDK's current shape */
    it("mints with the SDK's shape, tolerates the retired ids field and round-trips a config", async () => {
      const { call } = await mountedCreate({ kind: "project" });

      const minted = await call("POST", "/virtual-keys", { body: { name: "ci-key" } });
      const reread = await call("GET", `/virtual-keys/${minted.body.virtual_key?.id}`);
      const withRetiredField = await call("POST", "/virtual-keys", {
        body: { name: "legacy-sdk", provider_credential_ids: ["mp_gone"] },
      });
      const configured = await call("POST", "/virtual-keys", {
        body: {
          name: "configured",
          scopes: [{ scope_type: "project", scope_id: OWN_PROJECT }],
          routing_mode: "fallback_all",
          config: { fallback: { maxAttempts: 2 } },
        },
      });

      expect(minted.status).toBe(201);
      expect(minted.body.secret).toMatch(/^vk-lw-/);
      expect(minted.body.virtual_key).toMatchObject({
        scopes: [{ scope_type: "project", scope_id: OWN_PROJECT }],
        routing_mode: "none",
        purpose: "user",
      });
      expect(minted.text).not.toContain("provider_credential_ids");
      expect(reread.status).toBe(200);
      expect(reread.body.secret).toBeUndefined();
      expect(reread.text).not.toContain(minted.body.secret ?? "no secret was minted");
      expect(withRetiredField.status).toBe(201);
      expect(configured.status).toBe(201);
      expect(configured.body.virtual_key).toMatchObject({ routing_mode: "fallback_all" });
      expect(configured.body.virtual_key?.config).toMatchObject({ fallback: { maxAttempts: 2 } });
    });

    /** @scenario Explicit project scopes are accepted with config */
    it("accepts explicit project scopes with a config, and refuses an organization scope", async () => {
      const { call } = await mountedCreate({ kind: "project" });

      const projectScoped = await call("POST", "/virtual-keys", {
        body: {
          name: "explicit",
          scopes: [{ scope_type: "project", scope_id: OWN_PROJECT }],
          routing_mode: "fallback_all",
          config: { fallback: { maxAttempts: 2 } },
        },
      });
      const orgScoped = await call("POST", "/virtual-keys", {
        body: { name: "wide", scopes: [{ scope_type: "organization", scope_id: ORGANIZATION_ID }] },
      });

      expect(projectScoped.status).toBe(201);
      expect(projectScoped.body.virtual_key?.config).toMatchObject({
        fallback: { maxAttempts: 2 },
      });
      expect(orgScoped.status).toBe(403);
      expect(orgScoped.text).toContain("virtualKeys:manage");
    });
  });

  describe("given two keys that name no external id", () => {
    /** @scenario Two keys may both carry no external id */
    it("creates both, neither claiming an id", async () => {
      const { call } = await mountedCreate({ kind: "project" });

      const first = await call("POST", "/virtual-keys", { body: { name: "first" } });
      const second = await call("POST", "/virtual-keys", { body: { name: "second" } });

      expect([first.status, second.status]).toEqual([201, 201]);
      expect(first.body.virtual_key?.external_id).toBeNull();
      expect(second.body.virtual_key?.external_id).toBeNull();
    });
  });

  describe("given an API key bound to ADMIN at the organization", () => {
    /** @scenario Explicit project scopes are accepted with config */
    it("creates an organization-scoped key that every project caller reaches", async () => {
      const { call } = await mountedCreate(holdsEverything);

      const minted = await call("POST", "/virtual-keys", {
        body: {
          name: "org-wide",
          scopes: [{ scope_type: "organization", scope_id: ORGANIZATION_ID }],
          trace_project_id: OWN_PROJECT,
        },
      });
      const listed = await call("GET", "/virtual-keys");

      expect(minted.status).toBe(201);
      expect(minted.body.virtual_key?.scopes).toEqual([
        { scope_type: "organization", scope_id: ORGANIZATION_ID },
      ]);
      expect(listed.body.data?.map((key) => key.name)).toEqual(["org-wide"]);
    });

    /** @scenario An explicit trace destination gives an org-scoped key a home for its spend */
    it("echoes an explicit trace destination on an organization-scoped key", async () => {
      const { call } = await mountedCreate(holdsEverything);

      const minted = await call("POST", "/virtual-keys", {
        body: {
          name: "homed",
          scopes: [{ scope_type: "organization", scope_id: ORGANIZATION_ID }],
          trace_project_id: SIBLING_PROJECT,
        },
      });

      expect(minted.status).toBe(201);
      expect(minted.body.virtual_key?.trace_project_id).toBe(SIBLING_PROJECT);
    });
  });

  describe("given a project key naming another team's project as the destination", () => {
    /** @scenario An explicit trace destination gives an org-scoped key a home for its spend */
    it("is refused 403 before anything is minted", async () => {
      const { call } = await mountedCreate({ kind: "project" });

      const refused = await call("POST", "/virtual-keys", {
        body: { name: "stray", trace_project_id: OTHER_TEAM_PROJECT },
      });
      const listed = await call("GET", "/virtual-keys");

      expect(refused.status).toBe(403);
      expect(listed.body.data).toEqual([]);
    });
  });

  describe("given a Langy session key that holds virtualKeys:create and not manage", () => {
    /** @scenario Langy's session key mints a key for the project it speaks for */
    it("mints for its project, and is refused a team scope, a sibling trace project and rotation", async () => {
      const { call } = await mountedCreate(langySession);

      const own = await call("POST", "/virtual-keys", { body: { name: "langy-key" } });
      const team = await call("POST", "/virtual-keys", {
        body: { name: "team-key", scopes: [{ scope_type: "team", scope_id: "team_1" }] },
      });
      const sibling = await call("POST", "/virtual-keys", {
        body: { name: "sibling-key", trace_project_id: SIBLING_PROJECT },
      });
      const rotated = await call("POST", `/virtual-keys/${own.body.virtual_key?.id}/rotate`, {
        body: {},
      });

      expect(own.status).toBe(201);
      expect(own.body.virtual_key?.scopes).toEqual([
        { scope_type: "project", scope_id: OWN_PROJECT },
      ]);
      expect(team.status).toBe(403);
      expect(team.text).toContain("virtualKeys:manage");
      expect(sibling.status).toBe(403);
      expect(sibling.text).toContain("virtualKeys:manage");
      expect(rotated.status).toBe(403);
    });
  });

  describe("given a request the door or the schema refuses", () => {
    /** @scenario An explicit trace destination gives an org-scoped key a home for its spend */
    it("answers 401 missing_credentials without a key and 422 naming the offending fields", async () => {
      const { call } = await mountedCreate({ kind: "project" });

      const anonymous = await call("POST", "/virtual-keys", {
        anonymous: true,
        body: { name: "ci-key" },
      });
      const invalid = await call("POST", "/virtual-keys", { body: { name: "", routing_mode: 7 } });

      expect(anonymous.status).toBe(401);
      expect(anonymous.body).toMatchObject({
        type: "unauthenticated",
        code: "missing_credentials",
      });
      expect(invalid.status).toBe(422);
      expect(invalid.body.code).toBe("validation_error");
      expect(invalid.text).toContain("routing_mode");
      expect(invalid.text).toContain("reasons");
    });
  });
});
