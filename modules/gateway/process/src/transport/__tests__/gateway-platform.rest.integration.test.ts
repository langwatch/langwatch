/**
 * `/api/gateway/v1`, real declaration. Finding H12: a PROJECT-door family
 * resolves at the caller's project; by-id writes widen to the org first.
 * @see specs/security/resource-scope-permission-checks.feature
 */

// @vitest-environment node
import { createApiFixture } from "@langwatch/api-fixture";
import {
  apiErrorBody,
  bindRestMiddleware,
  createRestRuntime,
  type IdempotentRunner,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { PermissionDeniedError } from "@langwatch/authz-contract";
import {
  type GatewayApi,
  type GatewayKeyCaller,
  type GatewayBudgetResource,
  type GatewayBudgetWithSeats,
  type GatewayCacheRuleResource,
  type GatewayVirtualKeySnakeDto,
} from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import { Prisma } from "@langwatch/prisma-client/generated";
import { Temporal, type Instant } from "@langwatch/time";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";

import { virtualKeyRow } from "../../app/__tests__/gateway-virtual-key.fixture.ts";
import {
  gatewayKeyCaller,
  gatewayPlatformRest,
  gatewayProjectCredential,
} from "../gateway-platform.rest.ts";

const PROJECT_ID = "project_caller";
const ORGANIZATION_ID = "organization_1";

const passthroughIdempotency: IdempotentRunner = async ({ handler }) => {
  const response = await handler();
  return { isReplayed: false, status: response.status, response };
};

/** A minimal receipt ledger: the second call under the same key never reaches `handler`. */
function statefulIdempotency(): IdempotentRunner {
  const receipts = new Map<string, { status: number; serializedBody: string }>();
  return async ({ operation, scopeId, key, handler }) => {
    const receiptKey = `${operation}:${scopeId}:${key}`;
    const stored = key ? receipts.get(receiptKey) : undefined;
    if (stored)
      return { isReplayed: true, status: stored.status, serializedBody: stored.serializedBody };
    const response = await handler();
    if (key)
      receipts.set(receiptKey, {
        status: response.status,
        serializedBody: await response.clone().text(),
      });
    return { isReplayed: false, status: response.status, response };
  };
}

/** The canonical `{ type, code, message, ... }` envelope this family publishes. */
const onError: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const status = (error.httpStatus ?? 500) as ContentfulStatusCode;
    return c.json(
      apiErrorBody({
        status: status as number,
        code: error.code,
        message: error.message,
        meta: error.meta,
      }),
      status,
    );
  }
  return c.json(apiErrorBody({ status: 500, code: "internal_error", message: String(error) }), 500);
};

/** The key the key door resolves in these tests: an organization key naming no project. */
const ORGANIZATION_KEY_CALLER: GatewayKeyCaller = {
  kind: "apiKey",
  apiKeyId: "gateway-key",
  userId: "user_1",
  organizationId: ORGANIZATION_ID,
};

/**
 * The family behind both of its doors: project-door routes see the caller's
 * project, key-door routes (the organization-owned rows) the organization,
 * and each fact the declaration names is bound the way the process binds it.
 */
function mountFamily({
  app,
  idempotency,
  keyCaller = ORGANIZATION_KEY_CALLER,
}: {
  app: GatewayApi;
  idempotency: IdempotentRunner;
  keyCaller?: GatewayKeyCaller;
}) {
  const projectDoor = () => ({
    actor: { type: "api_key" as const, id: "gateway-key" },
    scope: { tier: "project" as const, id: PROJECT_ID },
  });
  const keyDoor = () => ({
    actor: { type: "user" as const, id: "user_1" },
    scope: { tier: "organization" as const, id: ORGANIZATION_ID },
  });
  const runtime = createRestRuntime({
    identity: { authenticate: projectDoor, identify: projectDoor },
    doors: { apiKey: { authenticate: keyDoor, identify: keyDoor } },
    idempotency,
  });

  return runtime.mount(gatewayPlatformRest.router(), {
    app: () => app,
    onError,
    facts: [
      bindRestMiddleware(gatewayKeyCaller, () => keyCaller),
      bindRestMiddleware(gatewayProjectCredential, () => ({ kind: "legacyProjectKey" as const })),
    ],
  });
}

function mountGatewayPlatform(options: { allowedAtOrganization: readonly string[] }) {
  const probed: string[] = [];
  const archiveBudget = vi.fn(async (): Promise<GatewayBudgetResource> => {
    throw new Error("the write must not run for a refused caller");
  });
  const updateCacheRule = vi.fn(async (): Promise<GatewayCacheRuleResource> => {
    throw new Error("the write must not run for a refused caller");
  });

  const refuseUnlessAllowed = (permission: string, organizationId: string) => {
    probed.push(`${permission}@${organizationId}`);
    if (options.allowedAtOrganization.includes(permission)) return;
    throw new PermissionDeniedError({
      permission,
      scope: { type: "organization", id: organizationId },
      denialReason: "no-binding",
    });
  };
  const app = createApiFixture<GatewayApi>({
    organizationIdForProject: async () => ORGANIZATION_ID,
    actorForCredential: () => ({ actor: { kind: "legacyProjectKey" }, actorUserId: "svc" }),
    authorizeOrganizationWideOperation: async (input) =>
      refuseUnlessAllowed(input.permission, input.organizationId),
    authorizeKeyCaller: async (input) => {
      refuseUnlessAllowed(input.permission, ORGANIZATION_ID);
      return { organizationId: ORGANIZATION_ID, actor: null, actorUserId: "user_1" };
    },
    archiveBudget,
    updateCacheRule,
    groupMemberCounts: async () => new Map<string, number>(),
  });

  const hono = mountFamily({ app, idempotency: passthroughIdempotency });

  return {
    probed,
    archiveBudget,
    updateCacheRule,
    archiveBudgetRequest: (id: string) =>
      hono.request(`/api/gateway/v1/budgets/${id}`, { method: "DELETE" }),
    updateCacheRuleRequest: (id: string) =>
      hono.request(`/api/gateway/v1/cache-rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: 10 }),
      }),
  };
}

describe("the gateway platform family's organization-wide writes", () => {
  describe("given a project-scoped credential with no organization grant", () => {
    /** @scenario An organization-wide gateway write is authorized at the organization */
    it("refuses to archive a budget, and archives nothing", async () => {
      const world = mountGatewayPlatform({ allowedAtOrganization: [] });

      const response = await world.archiveBudgetRequest("budget_of_sibling_project");

      expect(response.status).toBe(403);
      expect(world.probed).toEqual([`gatewayBudgets:delete@${ORGANIZATION_ID}`]);
      expect(world.archiveBudget).not.toHaveBeenCalled();
    });

    /** @scenario An organization-wide gateway write is authorized at the organization */
    it("refuses to change a cache rule, and leaves it unchanged", async () => {
      const world = mountGatewayPlatform({ allowedAtOrganization: [] });

      const response = await world.updateCacheRuleRequest("cache_rule_1");

      expect(response.status).toBe(403);
      expect(world.probed).toEqual([`gatewayCacheRules:update@${ORGANIZATION_ID}`]);
      expect(world.updateCacheRule).not.toHaveBeenCalled();
    });
  });

  describe("given a credential that holds the permission at the organization", () => {
    it("lets the write through to the application", async () => {
      const world = mountGatewayPlatform({ allowedAtOrganization: ["gatewayBudgets:delete"] });
      world.archiveBudget.mockResolvedValueOnce({
        id: "budget_1",
        organizationId: ORGANIZATION_ID,
        scopeId: "scope_1",
      } as GatewayBudgetResource);

      await world.archiveBudgetRequest("budget_1");

      expect(world.archiveBudget).toHaveBeenCalledWith(
        expect.objectContaining({ id: "budget_1", organizationId: ORGANIZATION_ID }),
      );
    });
  });
});

const IDEMPOTENCY_KEY = "idem_key_1234567890";

const virtualKeyDto: GatewayVirtualKeySnakeDto = {
  id: "vk_1",
  organization_id: ORGANIZATION_ID,
  name: "k",
  description: null,
  status: "active",
  purpose: "user",
  display_prefix: "lw_",
  principal_user_id: null,
  trace_project_id: null,
  trace_project_archived: false,
  external_id: null,
  metadata: {},
  scopes: [{ scope_type: "project", scope_id: PROJECT_ID }],
  routing_policy_id: null,
  routing_mode: "none",
  config: {},
  revision: "1",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  last_used_at: null,
  revoked_at: null,
  expires_at: null,
};

function budgetRow(overrides: Partial<GatewayBudgetWithSeats> = {}): GatewayBudgetWithSeats {
  const now: Instant = Temporal.Instant.from("2026-08-01T00:00:00.000Z");
  return {
    id: "bgt_1",
    organizationId: ORGANIZATION_ID,
    scopeType: "PROJECT",
    scopeId: PROJECT_ID,
    providerKey: null,
    name: "cap",
    description: null,
    window: "MONTH",
    limitUsd: new Prisma.Decimal("25.500000"),
    onBreach: "BLOCK",
    timezone: null,
    spentUsd: new Prisma.Decimal("0"),
    currentPeriodStartedAt: now,
    resetsAt: now,
    lastResetAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    createdById: "usr_1",
    managedByVirtualKeyId: null,
    ...overrides,
  } as GatewayBudgetWithSeats;
}

function cacheRuleRow(overrides: Partial<GatewayCacheRuleResource> = {}): GatewayCacheRuleResource {
  const now = new Date("2026-08-01T00:00:00.000Z");
  return {
    id: "car_1",
    organizationId: ORGANIZATION_ID,
    name: "rule",
    description: null,
    priority: 0,
    enabled: true,
    matchers: {},
    action: { mode: "respect" },
    mode: "RESPECT",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    createdById: "usr_1",
    ...overrides,
  };
}

/** Mounts the family behind a stateful idempotency ledger. */
function mountIdempotentGatewayPlatform(app: GatewayApi) {
  const hono = mountFamily({ app, idempotency: statefulIdempotency() });

  return {
    post: (path: string, body: unknown) =>
      hono.request(`/api/gateway/v1${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": IDEMPOTENCY_KEY },
        body: JSON.stringify(body),
      }),
  };
}

describe("the gateway platform family's idempotent creates", () => {
  /** @scenario A retried virtual-key create does not mint a second key */
  it("does not call createVirtualKey twice for a replayed request", async () => {
    const createVirtualKey = vi.fn(async () => ({
      virtualKey: virtualKeyRow(),
      secret: "secret_1",
    }));
    const app = createApiFixture<GatewayApi>({
      organizationIdForProject: async () => ORGANIZATION_ID,
      actorForCredential: () => ({ actor: { kind: "legacyProjectKey" }, actorUserId: "svc" }),
      authorizeVirtualKeyCreate: async () => {},
      createVirtualKey,
      toVirtualKeySnakeDto: async () => virtualKeyDto,
    });
    const world = mountIdempotentGatewayPlatform(app);
    const body = { name: "my key" };

    const first = await world.post("/virtual-keys", body);
    const second = await world.post("/virtual-keys", body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(createVirtualKey).toHaveBeenCalledTimes(1);
  });

  /** @scenario A retried virtual-key rotate does not mint a second secret */
  it("does not call rotateVirtualKey twice for a replayed request", async () => {
    const rotateVirtualKey = vi.fn(async () => ({
      virtualKey: virtualKeyRow(),
      secret: "secret_2",
    }));
    const app = createApiFixture<GatewayApi>({
      organizationIdForProject: async () => ORGANIZATION_ID,
      actorForCredential: () => ({ actor: { kind: "legacyProjectKey" }, actorUserId: "svc" }),
      authorizeVirtualKeyOperation: async () => virtualKeyRow(),
      rotateVirtualKey,
      toVirtualKeySnakeDto: async () => virtualKeyDto,
    });
    const world = mountIdempotentGatewayPlatform(app);

    const first = await world.post("/virtual-keys/vk_1/rotate", {});
    const second = await world.post("/virtual-keys/vk_1/rotate", {});

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(rotateVirtualKey).toHaveBeenCalledTimes(1);
  });

  /** @scenario A retried budget create does not mint a second budget */
  it("does not call createBudget twice for a replayed request", async () => {
    const row = budgetRow();
    const createBudget = vi.fn(async () => row);
    const app = createApiFixture<GatewayApi>({
      authorizeKeyCaller: async () => ({
        organizationId: ORGANIZATION_ID,
        actor: null,
        actorUserId: "user_1",
      }),
      createBudget,
      groupMemberCounts: async () => new Map<string, number>(),
      budgetScopeReach: async () => ({
        reachable: true,
        reachableProjectIds: [PROJECT_ID],
        activeKeyCount: 1,
      }),
    });
    const world = mountIdempotentGatewayPlatform(app);
    const body = {
      scope: { kind: "project", project_id: PROJECT_ID },
      name: "cap",
      window: "month",
      limit_usd: "25.50",
    };

    const first = await world.post("/budgets", body);
    const second = await world.post("/budgets", body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(createBudget).toHaveBeenCalledTimes(1);
  });

  /** @scenario A retried cache-rule create does not mint a second rule */
  it("does not call createCacheRule twice for a replayed request", async () => {
    const row = cacheRuleRow();
    const createCacheRule = vi.fn(async () => row);
    const app = createApiFixture<GatewayApi>({
      organizationIdForProject: async () => ORGANIZATION_ID,
      actorForCredential: () => ({ actor: { kind: "legacyProjectKey" }, actorUserId: "svc" }),
      authorizeOrganizationWideOperation: async () => {},
      createCacheRule,
    });
    const world = mountIdempotentGatewayPlatform(app);
    const body = { name: "rule", matchers: { model: "gpt-5-mini" }, action: { mode: "respect" } };

    const first = await world.post("/cache-rules", body);
    const second = await world.post("/cache-rules", body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(createCacheRule).toHaveBeenCalledTimes(1);
  });
});

describe("the gateway budget routes behind the key door", () => {
  const readAt = Temporal.Instant.from("2026-08-02T00:00:00.000Z");

  describe("given an organization key that names no project", () => {
    /** @scenario The budget routes take an organization key and hand its caller to the application */
    it("lists the organization's budgets for the caller the key door resolved", async () => {
      const authorizeKeyCaller = vi.fn(async () => ({
        organizationId: ORGANIZATION_ID,
        actor: null,
        actorUserId: "user_1",
      }));
      const listBudgetPageWithHealth = vi.fn(async () => ({
        budgets: [budgetRow()],
        spendAvailable: true,
        readAt,
        scopeReach: new Map(),
        total: 1,
      }));
      const app = createApiFixture<GatewayApi>({
        authorizeKeyCaller,
        listBudgetPageWithHealth,
        groupMemberCounts: async () => new Map<string, number>(),
      });
      const hono = mountFamily({ app, idempotency: passthroughIdempotency });

      const response = await hono.request("/api/gateway/v1/budgets");

      expect(response.status).toBe(200);
      expect(authorizeKeyCaller).toHaveBeenCalledWith({
        caller: ORGANIZATION_KEY_CALLER,
        permission: "gatewayBudgets:view",
        reach: "caller",
      });
      expect(listBudgetPageWithHealth).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORGANIZATION_ID }),
      );
      const body = (await response.json()) as { data: { id: string }[] };
      expect(body.data.map((budget) => budget.id)).toEqual(["bgt_1"]);
    });

    /** @scenario The budget routes take an organization key and hand its caller to the application */
    it("creates a budget after authorizing the key at the organization", async () => {
      const authorizeKeyCaller = vi.fn(async () => ({
        organizationId: ORGANIZATION_ID,
        actor: null,
        actorUserId: "user_1",
      }));
      const createBudget = vi.fn(async () => budgetRow({ scopeType: "TEAM", scopeId: "team_1" }));
      const app = createApiFixture<GatewayApi>({
        authorizeKeyCaller,
        createBudget,
        groupMemberCounts: async () => new Map<string, number>(),
        budgetScopeReach: async () => ({
          reachable: true,
          reachableProjectIds: [PROJECT_ID],
          activeKeyCount: 1,
        }),
      });
      const hono = mountFamily({ app, idempotency: passthroughIdempotency });

      const response = await hono.request("/api/gateway/v1/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: { kind: "team", team_id: "team_1" },
          name: "Payments monthly",
          window: "month",
          limit_usd: "150",
        }),
      });

      expect(response.status).toBe(201);
      expect(authorizeKeyCaller).toHaveBeenCalledWith(
        expect.objectContaining({ permission: "gatewayBudgets:create", reach: "organization" }),
      );
      expect(createBudget).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORGANIZATION_ID, actorUserId: "user_1" }),
      );
    });

    describe("when the key does not hold the permission", () => {
      /** @scenario The budget routes take an organization key and hand its caller to the application */
      it("answers 403 permission_denied and never reaches the write", async () => {
        const world = mountGatewayPlatform({ allowedAtOrganization: [] });

        const response = await world.archiveBudgetRequest("budget_1");

        expect(response.status).toBe(403);
        const body = (await response.json()) as { code: string };
        expect(body.code).toBe("permission_denied");
        expect(world.archiveBudget).not.toHaveBeenCalled();
      });
    });
  });

  describe("when a budget's limit is raised", () => {
    /** @scenario A budget update answers with the spend the listing reports */
    it("answers with the live spend, not the stored column", async () => {
      const written = budgetRow({ limitUsd: new Prisma.Decimal("300") });
      const live = budgetRow({
        limitUsd: new Prisma.Decimal("300"),
        spentUsd: new Prisma.Decimal("100.14"),
      });
      const app = createApiFixture<GatewayApi>({
        authorizeKeyCaller: async () => ({
          organizationId: ORGANIZATION_ID,
          actor: null,
          actorUserId: "user_1",
        }),
        updateBudget: async () => written,
        getBudgetWithHealth: async () => ({
          budget: live,
          spendAvailable: true,
          readAt,
          unreachableByAnyKey: false,
        }),
        groupMemberCounts: async () => new Map<string, number>(),
      });
      const hono = mountFamily({ app, idempotency: passthroughIdempotency });

      const response = await hono.request("/api/gateway/v1/budgets/bgt_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit_usd: "300" }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { budget: { spent_usd: string; limit_usd: string } };
      expect(Number(body.budget.spent_usd)).toBeCloseTo(100.14);
    });
  });
});
