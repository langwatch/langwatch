/**
 * @vitest-environment node
 * /api/gateway/v1 refusals raised by the shared gateway services, through the
 * real GatewayApp and the production error mapping.
 * @see specs/ai-gateway/public-rest-api.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { bindRestMiddleware, canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { GatewayRequestCredential } from "@langwatch/gateway-contract";
import { ResourceScope } from "@langwatch/process";
import type { Encryption } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { GatewayApp } from "../../app/gateway.app.ts";
import {
  gatewayKeyCaller,
  gatewayPlatformRest,
  gatewayRestCredential,
} from "../gateway-platform.rest.ts";

const ORG_ID = "organization_1";
const PROJECT_ID = "project_1";

const legacyProjectKey: GatewayRequestCredential = { kind: "legacyProjectKey" };
const testSecrets = new ScopedSecrets(async (_handle, build) =>
  build("0123456789abcdef0123456789abcdef"),
);
const reversible: Encryption = {
  encrypt: (plaintext) => `sealed:${plaintext}`,
  decrypt: (ciphertext) => ciphertext.replace(/^sealed:/, ""),
};

function projectsIn(args: unknown): { id: string }[] {
  const where: unknown =
    typeof args === "object" && args !== null ? Reflect.get(args, "where") : {};
  const id: unknown =
    typeof where === "object" && where !== null ? Reflect.get(where, "id") : undefined;
  const ids: unknown = typeof id === "object" && id !== null ? Reflect.get(id, "in") : [];
  return Array.isArray(ids)
    ? ids.filter((x) => x === PROJECT_ID).map((x) => ({ id: String(x) }))
    : [];
}

async function mount() {
  const prisma = prismaDouble({
    project: { findMany: async (args) => projectsIn(args) },
    gatewayBudget: { findFirst: async () => null },
    virtualKey: { findFirst: async () => null },
  });
  const app = await GatewayApp.create({
    dependencies: {
      webhooks: createApiFixture({}),
      entitlement: createApiFixture({}),
      authz: createApiFixture<AuthzApi>({}),
      projects: createApiFixture<ProjectApi>({
        findOrganizationId: async () => ORG_ID,
        listTraceDestinations: async () => [],
        listIdsByOrganization: async () => [PROJECT_ID],
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
    members: {
      prisma,
      clickhouse: createApiFixture<ClickHouseQueryClient>({}),
      encryption: reversible,
      redis: memoryRedisDouble(),
      publicBaseUrl: "https://app.acme.example",
    },
    config: {
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      baseUrl: void 0,
      publicUrl: void 0,
      isSaas: false,
      allowLoopbackVoiceProviders: false,
    },
    resources: new ResourceScope(),
    secrets: testSecrets,
  });
  const door = () => ({
    actor: { type: "api_key" as const, id: "legacy-project-key" },
    scope: { tier: "project" as const, id: PROJECT_ID },
  });
  const keyDoor = () => ({ ...door(), scope: { tier: "organization" as const, id: ORG_ID } });
  const runtime = createRestRuntime({
    identity: { authenticate: door, identify: door },
    doors: { apiKey: { authenticate: keyDoor, identify: keyDoor } },
    idempotency: async ({ handler }) => {
      const response = await handler();
      return { isReplayed: false, status: response.status, response };
    },
  });
  const hono = runtime.mount(gatewayPlatformRest.router(), {
    app: () => app,
    onError: canonicalErrorResponse,
    facts: [
      bindRestMiddleware(gatewayRestCredential, () => legacyProjectKey),
      bindRestMiddleware(gatewayKeyCaller, () => ({
        kind: "project" as const,
        projectId: PROJECT_ID,
      })),
    ],
  });
  return async (method: string, path: string, body?: object) => {
    const response = await hono.request(`/api/gateway/v1${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const answer: unknown = await response.json();
    return { status: response.status, answer };
  };
}

const orgBudget = (extra: object) => ({
  scope: { kind: "organization", organization_id: ORG_ID },
  name: "cap",
  limit_usd: "10",
  ...extra,
});

describe("the gateway platform family's service refusals", () => {
  describe("given a legacy project key", () => {
    /** @scenario A legacy project key cannot mint keys beyond its own project */
    it("refuses an organization-scoped key, naming the missing grant", async () => {
      const send = await mount();

      const { status, answer } = await send("POST", "/virtual-keys", {
        name: "k",
        scopes: [{ scope_type: "organization", scope_id: ORG_ID }],
      });

      expect(status).toBe(403);
      expect(answer).toMatchObject({
        code: "permission_denied",
        meta: { permission: "virtualKeys:manage" },
      });
    });

    /** @scenario Cross-org scopes are rejected */
    it("refuses a scope from another organization by code", async () => {
      const send = await mount();

      const { status, answer } = await send("POST", "/virtual-keys", {
        name: "k",
        scopes: [{ scope_type: "project", scope_id: "project_foreign" }],
      });

      expect(status).toBe(400);
      expect(answer).toMatchObject({ code: "gateway_scope_org_mismatch" });
    });
  });

  describe("given a key that asks for routing policy without naming one", () => {
    /** @scenario routing_mode POLICY requires a routing policy id */
    it("refuses with 400 routing_policy_required", async () => {
      const send = await mount();

      const { status, answer } = await send("POST", "/virtual-keys", {
        name: "k",
        routing_mode: "policy",
      });

      expect(status).toBe(400);
      expect(answer).toMatchObject({ code: "routing_policy_required" });
    });
  });

  describe("given a budget id nothing holds", () => {
    /** @scenario An absent budget answers a canonical 404 */
    it("answers 404 budget_not_found", async () => {
      const send = await mount();

      const { status, answer } = await send("GET", "/budgets/bgt_missing");

      expect(status).toBe(404);
      expect(answer).toMatchObject({ type: "not_found", code: "budget_not_found" });
    });
  });

  describe("given a cycle anchor on a window that never rolls", () => {
    /** @scenario A cycle anchor on a window that never rolls is refused */
    it.each(["manual", "total"])("refuses the %s window by code", async (window) => {
      const send = await mount();

      const { status, answer } = await send(
        "POST",
        "/budgets",
        orgBudget({ window, cycle_anchor_at: "2026-01-17T09:00:00.000Z" }),
      );

      expect(status).toBe(400);
      expect(answer).toMatchObject({
        code: "gateway_budget_cycle_anchor_invalid",
        meta: { window },
      });
    });
  });
});
