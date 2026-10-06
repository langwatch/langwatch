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
import { GroupNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
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
import {
  MemoryGatewayStore,
  memoryGatewayModelProvider,
} from "../../repositories/memory/memory.gateway.store.ts";
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
const GROUP_ID = "group_1";
const PROVIDER_ID = "mp_1";
const FOREIGN_PROVIDER_ID = "mp_foreign";
const FOREIGN_ORGANIZATION_ID = "org_2";

const secrets = new ScopedSecrets(async (_handle, build) => build(undefined));

const budgetWire = z.looseObject({
  id: z.string(),
  scope_type: z.string(),
  limit_usd: z.string(),
  on_breach: z.string(),
  spent_usd: z.string().nullable(),
  archived_at: z.string().nullable(),
  external_id: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  provider_key: z.string().nullable().optional(),
  member_count: z.number().optional(),
  end_users_seen: z.number().optional(),
  end_users_over: z.number().optional(),
});
const wire = z.looseObject({
  budget: budgetWire.optional(),
  data: z.array(budgetWire).optional(),
  spend_available: z.boolean().optional(),
  code: z.string().optional(),
  error: z.looseObject({ code: z.string().optional() }).optional(),
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
    groups: [{ id: GROUP_ID, organizationId: ORGANIZATION_ID, name: "Core" }],
    groupMemberships: [
      { groupId: GROUP_ID, userId: USER_ID },
      { groupId: GROUP_ID, userId: "user_2" },
    ],
    modelProviders: [
      memoryGatewayModelProvider({
        id: PROVIDER_ID,
        name: "Team OpenAI",
        provider: "openai",
        organizationId: ORGANIZATION_ID,
      }),
      memoryGatewayModelProvider({
        id: FOREIGN_PROVIDER_ID,
        name: "Their OpenAI",
        provider: "openai",
        organizationId: FOREIGN_ORGANIZATION_ID,
      }),
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
        getGroup: async ({ organizationId, groupId }) => {
          const group = store.groups.find(
            (candidate) => candidate.id === groupId && candidate.organizationId === organizationId,
          );
          if (!group) throw new GroupNotFoundError(groupId);
          const at = new Date("2026-09-01T00:00:00Z");
          return {
            id: group.id,
            organizationId,
            name: group.name,
            slug: group.id,
            externalId: null,
            scimSource: null,
            createdAt: at,
            updatedAt: at,
            members: [],
            grants: [],
          };
        },
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

  describe("given a budget on a virtual key", () => {
    /** @scenario One budget can be read on its own */
    it("reads by id as the row the list serves for that id, with spend available", async () => {
      const { call } = await mountedBudgets();
      const created = await call("POST", "/budgets", {
        name: "key cap",
        scope: { kind: "virtual_key", virtual_key_id: KEY_ID },
        window: "month",
        limit_usd: "10",
      });
      const id = created.body.budget?.id ?? "";

      const byId = await call("GET", `/budgets/${id}`);
      const listed = await call("GET", "/budgets");

      expect(byId.status).toBe(200);
      expect(byId.body.spend_available).toBe(true);
      expect(byId.body.budget).toEqual(listed.body.data?.find((row) => row.id === id));
    });
  });

  describe("given budgets that carry the caller's own id and bookkeeping", () => {
    const withIds = {
      name: "tracked",
      scope: { kind: "virtual_key", virtual_key_id: KEY_ID },
      window: "month",
      limit_usd: "10",
      external_id: "budget-ext-1",
      metadata: { team: "growth" },
    };

    /** @scenario A budget carries the caller's own id and bookkeeping */
    it("returns both on create, by id and on the list, filters by id and refuses a duplicate", async () => {
      const { call } = await mountedBudgets();

      const created = await call("POST", "/budgets", withIds);
      const id = created.body.budget?.id ?? "";
      const byId = await call("GET", `/budgets/${id}`);
      const listed = await call("GET", "/budgets");
      const filtered = await call("GET", "/budgets?external_id=budget-ext-1");
      const missed = await call("GET", "/budgets?external_id=nobody");
      const duplicate = await call("POST", "/budgets", { ...withIds, name: "second" });

      const carried = { external_id: "budget-ext-1", metadata: { team: "growth" } };
      expect(created.status).toBe(201);
      expect(created.body.budget).toMatchObject(carried);
      expect(byId.body.budget).toMatchObject(carried);
      expect(listed.body.data?.[0]).toMatchObject(carried);
      expect(filtered.body.data?.map((row) => row.id)).toEqual([id]);
      expect(missed.body.data).toEqual([]);
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.code ?? duplicate.body.error?.code).toBe("external_id_conflict");
    });
  });

  describe("given a group-scoped budget and an attributed-user template", () => {
    /** @scenario A GROUP budget over REST carries the per-member semantics */
    it("reports the member count, the per-member limit and the whole group's spend", async () => {
      const { call, repositories } = await mountedBudgets();

      const created = await call("POST", "/budgets", {
        name: "group cap",
        scope: { kind: "group", group_id: GROUP_ID },
        window: "month",
        limit_usd: "40",
        allow_unreachable: true,
      });
      const budget = created.body.budget;
      if (!budget) throw new Error("the create answered no budget");
      const grouped = {
        id: budget.id,
        scopeType: "GROUP",
        scopeId: GROUP_ID,
        window: "MONTH",
      } as const;
      await repositories.budgetSpend.insertDebit([
        memoryDebitSeed({
          budget: grouped,
          amountUsd: "1.5",
          gatewayRequestId: "req_a",
          bucketScopeId: `${GROUP_ID}:${USER_ID}`,
          tenantId: PROJECT_ID,
        }),
      ]);
      await repositories.budgetSpend.insertDebit([
        memoryDebitSeed({
          budget: grouped,
          amountUsd: "2.5",
          gatewayRequestId: "req_b",
          bucketScopeId: `${GROUP_ID}:user_2`,
          tenantId: PROJECT_ID,
        }),
      ]);
      const listed = await call("GET", "/budgets?scope_type=group");

      expect(created.status).toBe(201);
      expect(budget).toMatchObject({ scope_type: "group", member_count: 2 });
      expect(listed.body.data?.[0]).toMatchObject({ limit_usd: "40", spent_usd: "4" });
    });

    /** @scenario An ATTRIBUTED_USER budget over REST carries the per-person standing */
    it("lists a per-person template with its per-person cap and how many end users are over", async () => {
      const { call, repositories } = await mountedBudgets();

      const template = await call("POST", "/budgets", {
        name: "per person",
        scope: { kind: "attributed_user", anchor_virtual_key_id: KEY_ID },
        window: "month",
        limit_usd: "1",
      });
      const plain = await call("POST", "/budgets", {
        name: "key cap",
        scope: { kind: "virtual_key", virtual_key_id: KEY_ID },
        window: "month",
        limit_usd: "10",
      });
      const id = template.body.budget?.id ?? "";
      const anchored = {
        id,
        scopeType: "ATTRIBUTED_USER",
        scopeId: KEY_ID,
        window: "MONTH",
      } as const;
      await repositories.budgetSpend.insertDebit([
        memoryDebitSeed({
          budget: anchored,
          amountUsd: "1.5",
          gatewayRequestId: "req_over",
          bucketScopeId: `${KEY_ID}:end_user_a`,
          tenantId: PROJECT_ID,
        }),
      ]);
      await repositories.budgetSpend.insertDebit([
        memoryDebitSeed({
          budget: anchored,
          amountUsd: "0.25",
          gatewayRequestId: "req_under",
          bucketScopeId: `${KEY_ID}:end_user_b`,
          tenantId: PROJECT_ID,
        }),
      ]);
      const listed = await call("GET", "/budgets");

      const rows = new Map(listed.body.data?.map((row) => [row.id, row]));
      expect([template.status, plain.status]).toEqual([201, 201]);
      expect(rows.get(id)).toMatchObject({ limit_usd: "1", end_users_seen: 2, end_users_over: 1 });
      expect(rows.get(plain.body.budget?.id ?? "")).not.toHaveProperty("end_users_seen");
      expect(rows.get(plain.body.budget?.id ?? "")).not.toHaveProperty("end_users_over");
    });
  });

  describe("given a budget filtered to a model provider", () => {
    /** @scenario A provider-filtered budget round-trips provider_key */
    it("echoes the provider of the organization and refuses another tenant's by code", async () => {
      const { call } = await mountedBudgets();
      const budgetFor = (providerKey: string) => ({
        name: `provider ${providerKey}`,
        scope: { kind: "organization", organization_id: ORGANIZATION_ID },
        window: "month",
        limit_usd: "5",
        provider_key: providerKey,
      });

      const own = await call("POST", "/budgets", budgetFor(PROVIDER_ID));
      const foreign = await call("POST", "/budgets", budgetFor(FOREIGN_PROVIDER_ID));
      const listed = await call("GET", "/budgets");

      expect(own.status).toBe(201);
      expect(own.body.budget?.provider_key).toBe(PROVIDER_ID);
      expect(foreign.status).toBe(400);
      expect(foreign.body.code ?? foreign.body.error?.code).toBe("gateway_scope_org_mismatch");
      expect(listed.body.data?.map((row) => row.provider_key)).toEqual([PROVIDER_ID]);
    });
  });

  describe("given a key budget whose ledger carries a debit the stored column never saw", () => {
    /** @scenario REST budget spend is the live ClickHouse ledger, not the stale PG column */
    it("lists the ledger's spend, then echoes an update and archives keeping the ledger", async () => {
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
          gatewayRequestId: "req_live",
          tenantId: PROJECT_ID,
        }),
      ]);

      const listed = await call("GET", "/budgets");
      const updated = await call("PATCH", `/budgets/${budget.id}`, {
        limit_usd: "30",
        on_breach: "warn",
      });
      const archived = await call("DELETE", `/budgets/${budget.id}`);
      const ledger = await repositories.budgetSpend.recentEventsForBudget(
        [PROJECT_ID],
        budget.id,
        20,
      );

      expect(created.body.budget?.spent_usd).toBe("0");
      expect(listed.body.data?.[0]?.spent_usd).toBe("1.25");
      expect(updated.body.budget).toMatchObject({
        limit_usd: "30",
        on_breach: "warn",
        spent_usd: "1.25",
      });
      expect(archived.body.budget?.archived_at).not.toBeNull();
      expect(ledger.map((event) => event.id)).toEqual(["req_live"]);
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
