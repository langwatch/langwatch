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
  type GatewayBudgetResource,
  type GatewayBudgetWithSeats,
  type GatewayCacheRuleResource,
  type GatewayRequestCredential,
  type GatewayVirtualKeySnakeDto,
} from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import { Prisma } from "@langwatch/prisma-client/generated";
import { Temporal, type Instant } from "@langwatch/time";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";

import { virtualKeyRow } from "../../app/__tests__/gateway-virtual-key.fixture.ts";
import { gatewayPlatformRest, gatewayRestCredential } from "../gateway-platform.rest.ts";

const PROJECT_ID = "project_caller";
const ORGANIZATION_ID = "organization_1";

const scopedKey: GatewayRequestCredential = {
  kind: "apiKey",
  apiKeyId: "key_1",
  userId: "user_1",
  organizationId: ORGANIZATION_ID,
};

/** The fixture's caller: the credential stands as the actor, attributed as the composition does. */
const callerOf: Pick<GatewayApi, "actorForCredential"> = {
  actorForCredential: ({ projectId, credential }) => ({
    actor: credential,
    actorUserId: (credential.kind === "apiKey" ? credential.userId : null) ?? `svc_${projectId}`,
  }),
};

function credentialFact(credential: GatewayRequestCredential = scopedKey) {
  return bindRestMiddleware(gatewayRestCredential, () => credential);
}

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

function mountGatewayPlatform(options: { allowedAtOrganization: readonly string[] }) {
  const probed: string[] = [];
  const archiveBudget = vi.fn(async (): Promise<GatewayBudgetResource> => {
    throw new Error("the write must not run for a refused caller");
  });
  const updateCacheRule = vi.fn(async (): Promise<GatewayCacheRuleResource> => {
    throw new Error("the write must not run for a refused caller");
  });

  const app = createApiFixture<GatewayApi>({
    ...callerOf,
    organizationIdForProject: async () => ORGANIZATION_ID,
    authorizeOrganizationWideOperation: async (input) => {
      probed.push(`${input.permission}@${input.organizationId}`);
      if (options.allowedAtOrganization.includes(input.permission)) return;
      throw new PermissionDeniedError({
        permission: input.permission,
        scope: { type: "organization", id: input.organizationId },
        denialReason: "no-binding",
      });
    },
    archiveBudget,
    updateCacheRule,
    groupMemberCounts: async () => new Map<string, number>(),
  });

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "api_key", id: "gateway-key" },
        scope: { tier: "project", id: PROJECT_ID },
      }),
    },
    idempotency: passthroughIdempotency,
  });

  const hono = runtime.mount(gatewayPlatformRest.router(), {
    app: () => app,
    onError,
    facts: [credentialFact()],
  });

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

/** Mounts the family behind a stateful idempotency ledger, for a project-scoped credential. */
function mountIdempotentGatewayPlatform(app: GatewayApi) {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "api_key", id: "gateway-key" },
        scope: { tier: "project", id: PROJECT_ID },
      }),
    },
    idempotency: statefulIdempotency(),
  });

  const hono = runtime.mount(gatewayPlatformRest.router(), {
    app: () => app,
    onError,
    facts: [credentialFact()],
  });

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
      ...callerOf,
      organizationIdForProject: async () => ORGANIZATION_ID,
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
      ...callerOf,
      organizationIdForProject: async () => ORGANIZATION_ID,
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
      ...callerOf,
      organizationIdForProject: async () => ORGANIZATION_ID,
      authorizeOrganizationWideOperation: async () => {},
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
  /** @scenario The other keyed creates take the same header */
  it("does not call createCacheRule twice for a replayed request", async () => {
    const row = cacheRuleRow();
    const createCacheRule = vi.fn(async () => row);
    const app = createApiFixture<GatewayApi>({
      ...callerOf,
      organizationIdForProject: async () => ORGANIZATION_ID,
      authorizeOrganizationWideOperation: async () => {},
      createCacheRule,
    });
    const world = mountIdempotentGatewayPlatform(app);
    const body = { name: "rule", matchers: { model: "gpt-5-mini" }, action: { mode: "respect" } };

    const first = await world.post("/cache-rules", body);
    const second = await world.post("/cache-rules", body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("X-Idempotent-Replay")).toBe("true");
    expect(createCacheRule).toHaveBeenCalledTimes(1);
  });
});

const budgetBody = {
  scope: { kind: "project", project_id: PROJECT_ID },
  name: "cap",
  window: "month",
  limit_usd: "25.50",
};

/** Mounts the family as the project door hands a caller over: actor and credential fact. */
function mountAs({
  app,
  actor,
  credential,
}: {
  app: GatewayApi;
  actor: { type: "user"; id: string } | null;
  credential: GatewayRequestCredential;
}) {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor, scope: { tier: "project", id: PROJECT_ID } }),
    },
    idempotency: passthroughIdempotency,
  });
  const hono = runtime.mount(gatewayPlatformRest.router(), {
    app: () => app,
    onError,
    facts: [credentialFact(credential)],
  });

  return (path: string, body: unknown) =>
    hono.request(`/api/gateway/v1${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
}

describe("the gateway platform family's caller", () => {
  describe("given a scoped API key with the budget grant at the organization", () => {
    /** @scenario "A scoped API key with the budget grant at the organization creates a budget" */
    it("creates the budget as the key's owning user, 201", async () => {
      const authorizeOrganizationWideOperation = vi.fn(async () => {});
      const createBudget = vi.fn(async () => budgetRow());
      const post = mountAs({
        actor: { type: "user", id: "user_1" },
        credential: scopedKey,
        app: createApiFixture<GatewayApi>({
          ...callerOf,
          organizationIdForProject: async () => ORGANIZATION_ID,
          authorizeOrganizationWideOperation,
          createBudget,
          groupMemberCounts: async () => new Map<string, number>(),
          budgetScopeReach: async () => ({
            reachable: true,
            reachableProjectIds: [PROJECT_ID],
            activeKeyCount: 1,
          }),
        }),
      });

      const response = await post("/budgets", budgetBody);

      expect(response.status).toBe(201);
      expect(authorizeOrganizationWideOperation).toHaveBeenCalledWith({
        actor: scopedKey,
        organizationId: ORGANIZATION_ID,
        permission: "gatewayBudgets:create",
      });
      expect(createBudget).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "user_1" }));
    });
  });

  describe("given a key without the budget grant at the organization", () => {
    /** @scenario "A key without the budget grant at the organization is refused by code" */
    it("answers 403 permission_denied and creates no budget", async () => {
      const createBudget = vi.fn(async () => budgetRow());
      const post = mountAs({
        actor: { type: "user", id: "user_1" },
        credential: scopedKey,
        app: createApiFixture<GatewayApi>({
          ...callerOf,
          organizationIdForProject: async () => ORGANIZATION_ID,
          authorizeOrganizationWideOperation: async ({ permission, organizationId }) => {
            throw new PermissionDeniedError({
              permission,
              scope: { type: "organization", id: organizationId },
              denialReason: "no-binding",
            });
          },
          createBudget,
        }),
      });

      const response = await post("/budgets", budgetBody);

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: "permission_denied" });
      expect(createBudget).not.toHaveBeenCalled();
    });
  });

  describe("given a legacy project key", () => {
    /** @scenario "A legacy project key's own-project key is attributed to the machine principal" */
    it("mints its own project's key as svc_<projectId>, 201", async () => {
      const createVirtualKey = vi.fn(async () => ({
        virtualKey: virtualKeyRow(),
        secret: "secret_1",
      }));
      const post = mountAs({
        actor: null,
        credential: { kind: "legacyProjectKey" },
        app: createApiFixture<GatewayApi>({
          ...callerOf,
          organizationIdForProject: async () => ORGANIZATION_ID,
          authorizeVirtualKeyCreate: async () => {},
          createVirtualKey,
          toVirtualKeySnakeDto: async () => virtualKeyDto,
        }),
      });

      const response = await post("/virtual-keys", { name: "ci-key" });

      expect(response.status).toBe(201);
      expect(createVirtualKey).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: `svc_${PROJECT_ID}` }),
      );
    });
  });
});
