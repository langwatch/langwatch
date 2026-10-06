/**
 * The platform family's budget routes over the real application on its memory twins: what a
 * create writes is what the list reads, and an archive keeps the ledger it was charged against.
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
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  memoryDebitSeed,
  memoryVirtualKeySeed,
} from "../../__tests__/support/gateway-memory-seeds.fixture.ts";
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
const USER_ID = "user_1";

const secrets = new ScopedSecrets(async (_handle, build) => build(undefined));

const budgetWire = z.looseObject({
  id: z.string(),
  scope_type: z.string(),
  limit_usd: z.string(),
  on_breach: z.string(),
  spent_usd: z.string(),
  archived_at: z.string().nullable(),
});
const wire = z.looseObject({
  budget: budgetWire.optional(),
  data: z.array(budgetWire).optional(),
  spend_available: z.boolean().optional(),
});

const passthroughIdempotency: IdempotentRunner = async ({ handler }) => {
  const response = await handler();
  return { isReplayed: false, status: response.status, response };
};

/** Only the caller's identity is doubled; every budget read and write is the real application. */
async function mountedBudgets() {
  const store = MemoryGatewayStore.create({
    teams: [{ id: "team_1", organizationId: ORGANIZATION_ID, name: "Platform", slug: "platform" }],
    users: [
      { id: USER_ID, name: "Ada", email: "ada@acme.test", organizationIds: [ORGANIZATION_ID] },
    ],
  });
  const { repositories } = new MemoryGatewayRepositories(store);
  await repositories.virtualKeys.create(
    memoryVirtualKeySeed({ id: KEY_ID, name: "demo", organizationId: ORGANIZATION_ID }),
  );
  const real = await GatewayModule.create({
    dependencies: {
      authz: createApiFixture<AuthzApi>({}),
      projects: createApiFixture<ProjectApi>({
        listIdsByOrganization: async () => [PROJECT_ID],
        listTraceDestinations: async () => [],
      }),
      evaluators: createApiFixture({}),
      evaluations: createApiFixture({}),
      monitors: createApiFixture({}),
      organizations: createApiFixture<OrganizationApi>({
        getMember: async ({ organizationId, userId }) => ({
          userId,
          organizationId,
          role: "MEMBER",
          disabledAt: null,
          createdAt: Temporal.Instant.from("2026-09-01T00:00:00Z"),
          updatedAt: Temporal.Instant.from("2026-09-01T00:00:00Z"),
          user: { id: userId, name: "Ada", email: "ada@acme.test" },
          teams: [],
        }),
        listGroupsForMember: async () => [],
      }),
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
  const app = new Proxy(real, {
    get(target, key) {
      if (key === "getKeyCaller") {
        return async () => ({
          organizationId: ORGANIZATION_ID,
          actor: { kind: "legacyProjectKey" },
          actorUserId: "svc_project_1",
        });
      }
      const member = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  const door = () => ({
    actor: { type: "api_key" as const, id: "gateway-key" },
    scope: { tier: "organization" as const, id: ORGANIZATION_ID },
  });
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
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await hono.request(`/api/gateway/v1${path}`, {
      method,
      headers: { Authorization: "Bearer sk-lw-test", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: wire.parse(await response.json()) };
  };
  return { call, repositories };
}

describe("the platform family's budget routes", () => {
  describe("given a virtual-key and a principal budget created over REST", () => {
    /** @scenario A VK-scoped budget created over REST is visible in the REST list */
    it("lists both with spend available, and filters them by scope type", async () => {
      const { call } = await mountedBudgets();
      const created = [
        await call("POST", "/budgets", {
          name: "key cap",
          scope: { kind: "virtual_key", virtual_key_id: KEY_ID },
          window: "month",
          limit_usd: "10",
        }),
        await call("POST", "/budgets", {
          name: "person cap",
          scope: { kind: "principal", principal_user_id: USER_ID },
          window: "month",
          limit_usd: "20",
        }),
      ];

      const all = await call("GET", "/budgets");
      const keyOnly = await call("GET", "/budgets?scope_type=virtual_key");
      const orgAndTeam = await call("GET", "/budgets?scope_type=organization,team");

      expect(created.map((answer) => answer.status)).toEqual([201, 201]);
      expect(all.body.spend_available).toBe(true);
      expect(all.body.data?.map((row) => row.scope_type).toSorted()).toEqual([
        "principal",
        "virtual_key",
      ]);
      expect(keyOnly.body.data?.map((row) => row.scope_type)).toEqual(["virtual_key"]);
      expect(orgAndTeam.body.data).toEqual([]);
    });
  });

  describe("given a budget with spend already charged to it", () => {
    /** @scenario Budget update and archive over REST */
    it("echoes an update, archives on delete and keeps the ledger entries", async () => {
      const { call, repositories } = await mountedBudgets();
      const created = await call("POST", "/budgets", {
        name: "key cap",
        scope: { kind: "virtual_key", virtual_key_id: KEY_ID },
        window: "month",
        limit_usd: "10",
      });
      const budget = created.body.budget;
      if (!budget) throw new Error("the create answered no budget");
      await repositories.budgetSpend.insertDebit([
        memoryDebitSeed({
          budget: { id: budget.id, scopeType: "VIRTUAL_KEY", scopeId: KEY_ID, window: "MONTH" },
          amountUsd: "1.25",
          gatewayRequestId: "req_1",
        }),
      ]);

      const updated = await call("PATCH", `/budgets/${budget.id}`, {
        limit_usd: "30",
        on_breach: "warn",
      });
      const archived = await call("DELETE", `/budgets/${budget.id}`);
      const ledger = await repositories.budgetSpend.recentEventsForBudget(
        ["project_01"],
        budget.id,
        20,
      );

      expect(updated.body.budget).toMatchObject({ limit_usd: "30", on_breach: "warn" });
      expect(archived.status).toBe(200);
      expect(archived.body.budget?.archived_at).not.toBeNull();
      expect(ledger.map((event) => event.id)).toEqual(["req_1"]);
    });
  });
});
