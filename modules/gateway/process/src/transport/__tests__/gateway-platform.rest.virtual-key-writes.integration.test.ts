/**
 * The platform family's virtual-key writes over the real application on its memory twins: the
 * route declares the wire, the service the write, and the stored row answers what was changed.
 * @vitest-environment node
 * @see specs/ai-gateway/public-rest-api.feature
 */
import {
  bindRestMiddleware,
  canonicalErrorResponse,
  createRestRuntime,
  type IdempotentRunner,
} from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { memoryVirtualKeySeed } from "../../__tests__/support/gateway-memory-seeds.fixture.ts";
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
const PROJECT_ID = "project_1";
const KEY_ID = "vk_demo";

const secrets = new ScopedSecrets(async (handle, build) =>
  build(handle.id === "LW_VIRTUAL_KEY_PEPPER" ? "test-virtual-key-pepper" : undefined),
);

const wire = z.looseObject({
  secret: z.string().optional(),
  virtual_key: z
    .looseObject({
      name: z.string(),
      description: z.string().nullable(),
      revision: z.string(),
    })
    .optional(),
});

const passthroughIdempotency: IdempotentRunner = async ({ handler }) => {
  const response = await handler();
  return { isReplayed: false, status: response.status, response };
};

/** The key's own caller and the authorization checks are doubled; every write is the real one. */
async function mountedKeyWrites() {
  const store = MemoryGatewayStore.create({
    teams: [{ id: "team_1", organizationId: ORGANIZATION_ID, name: "Platform", slug: "platform" }],
  });
  const { repositories } = new MemoryGatewayRepositories(store);
  await repositories.virtualKeys.create({
    ...memoryVirtualKeySeed({ id: KEY_ID, name: "demo", organizationId: ORGANIZATION_ID }),
    description: "keep me",
    traceProjectId: PROJECT_ID,
  });
  const real = await GatewayModule.create({
    dependencies: {
      authz: createApiFixture<AuthzApi>({}),
      projects: createApiFixture<ProjectApi>({
        listTraceDestinations: async (projectIds) =>
          projectIds.map((id) => ({ id, teamId: "team_1", archivedAt: null })),
      }),
      evaluators: createApiFixture({}),
      evaluations: createApiFixture({}),
      monitors: createApiFixture({}),
      organizations: createApiFixture({}),
      featureFlags: createApiFixture({}),
      modelProviders: createApiFixture({}),
      traces: createApiFixture({}),
      oneTimeReveals: createApiFixture({}),
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
  const app = createApiFixture<GatewayApi>({
    getVirtualKeyCaller: async () => ({
      organizationId: ORGANIZATION_ID,
      actor: { kind: "legacyProjectKey" },
      actorUserId: "svc_project_1",
      projectId: PROJECT_ID,
    }),
    authorizeVirtualKeyOperation: (input) =>
      real.getExistingVirtualKey({ organizationId: input.organizationId, id: input.id }),
    authorizeVirtualKeyUpdate: (input) =>
      real.getExistingVirtualKey({ organizationId: input.organizationId, id: input.id }),
    rotateVirtualKey: (input) => real.rotateVirtualKey(input),
    updateVirtualKey: (input) => real.updateVirtualKey(input),
    parseVirtualKeyBudget: (input) => real.parseVirtualKeyBudget(input),
    toVirtualKeySnakeDto: (virtualKey) => real.toVirtualKeySnakeDto(virtualKey),
  });
  const door = ({ request }: { request: Request }) => {
    void request;
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
      bindRestMiddleware(gatewayKeyCaller, () => ({
        kind: "project" as const,
        projectId: PROJECT_ID,
      })),
      bindRestMiddleware(gatewayVirtualKeyCaller, () => ({
        kind: "project" as const,
        projectId: PROJECT_ID,
      })),
    ],
  });
  const call = async (method: string, path: string, body: unknown) => {
    const response = await hono.request(`/api/gateway/v1${path}`, {
      method,
      headers: { Authorization: "Bearer sk-lw-test", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, text, body: wire.parse(JSON.parse(text)) };
  };
  return { call, repositories };
}

describe("the platform family's virtual-key writes", () => {
  describe("given an existing key", () => {
    /** @scenario Update renames and re-caps a key through the shared service */
    it("renames and re-caps it, leaving the description untouched", async () => {
      const { call, repositories } = await mountedKeyWrites();

      const answer = await call("PATCH", `/virtual-keys/${KEY_ID}`, {
        name: "renamed",
        budget: { limit_usd: "50", window: "week" },
      });

      expect(answer.status).toBe(200);
      expect(answer.body.virtual_key).toMatchObject({ name: "renamed", description: "keep me" });
      const budgets = await repositories.keyBudgets.findActiveForKey({
        organizationId: ORGANIZATION_ID,
        virtualKeyId: KEY_ID,
        scope: "scopedToKey",
      });
      expect(budgets).toHaveLength(1);
      expect(budgets[0]).toMatchObject({ window: "WEEK" });
    });

    /** @scenario Rotate returns a fresh secret exactly once */
    it("rotates it to a new secret that no later answer repeats", async () => {
      const { call, repositories } = await mountedKeyWrites();
      const before = await repositories.virtualKeys.findById({
        id: KEY_ID,
        organizationId: ORGANIZATION_ID,
      });

      const rotated = await call("POST", `/virtual-keys/${KEY_ID}/rotate`, {});
      const later = await call("PATCH", `/virtual-keys/${KEY_ID}`, { name: "after" });

      expect(rotated.status).toBe(200);
      const secret = rotated.body.secret ?? "";
      expect(secret).toMatch(/^vk-lw-/);
      const after = await repositories.virtualKeys.findById({
        id: KEY_ID,
        organizationId: ORGANIZATION_ID,
      });
      expect(after?.hashedSecret).not.toBe(before?.hashedSecret);
      expect(rotated.body.virtual_key?.revision).toBe("2");
      expect(later.text).not.toContain(secret);
    });
  });
});
