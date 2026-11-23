/**
 * @vitest-environment node
 * Who reads or writes a member's budget over REST, off the real application on its memory twins.
 * @see modules/gateway/specs/gateway-budget-service.feature
 */
import {
  bindMiddlewareContext,
  canonicalErrorResponse,
  createRestRuntime,
  type IdempotentRunner,
} from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { GatewayBudget } from "@langwatch/gateway-contract";
import { MemberNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { nowInstant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { memoryVirtualKeySeed } from "../../__tests__/support/gateway-memory-seeds.fixture.ts";
import { MemoryGatewayChannels } from "../../channels/memory/memory.gateway.channels.ts";
import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import {
  MemoryGatewayStore,
  memoryGatewayDecimal,
} from "../../repositories/memory/memory.gateway.store.ts";
import {
  gatewayKeyCaller,
  gatewayPlatformRest,
  gatewayRestCredential,
  gatewayVirtualKeyCaller,
} from "../gateway-platform.rest.ts";
import { memoryGatewayApp } from "./support/gateway-memory-app.fixture.ts";

const ORG_ID = "org_1";
const PROJECT_ID = "project_1";
const BUDGET_ID = "bdg_1";
const OTHERS_PERSONAL = "virtualKeys:viewOtherPersonal";

/** Each API key: the user it acts for, if any, and what it holds at the organization. */
const API_KEYS = {
  ak_owner: { userId: "usr_owner", atOrganization: [] },
  ak_admin: { userId: "usr_admin", atOrganization: [OTHERS_PERSONAL] },
  ak_viewer: { userId: "usr_viewer", atOrganization: [] },
  ak_service: { userId: null, atOrganization: [] },
  ak_service_granted: { userId: null, atOrganization: [OTHERS_PERSONAL] },
} as const;
type ApiKeyId = keyof typeof API_KEYS;

const passthroughIdempotency: IdempotentRunner = async ({ handler }) => {
  const response = await handler();
  return { isReplayed: false, status: response.status, response };
};

function budgetOf({ ownerId }: { ownerId: string }): GatewayBudget {
  const now = nowInstant();
  return {
    id: BUDGET_ID,
    organizationId: ORG_ID,
    scopeType: "PRINCIPAL",
    scopeId: ownerId,
    name: "budget",
    description: null,
    window: "MONTH",
    onBreach: "BLOCK",
    limitUsd: memoryGatewayDecimal("100.00"),
    spentUsd: memoryGatewayDecimal("0.00"),
    timezone: null,
    providerKey: null,
    externalId: null,
    metadata: null,
    currentPeriodStartedAt: now.subtract({ hours: 2 }),
    resetsAt: now.add({ hours: 24 * 30 }),
    lastResetAt: null,
    cycleAnchorAt: null,
    archivedAt: null,
    createdAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    updatedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    createdById: "usr_admin",
    managedByVirtualKeyId: null,
  };
}

/** A write on `/budgets/:id`: its method, the path after the id, and its body. */
type BudgetWrite = { method: string; suffix: string; body: unknown };

const WRITES: Record<string, BudgetWrite> = {
  edit: { method: "PATCH", suffix: "", body: { name: "renamed" } },
  archive: { method: "DELETE", suffix: "", body: undefined },
  reset: { method: "POST", suffix: "/reset", body: {} },
};

/** Members of the organization; any other user id is not one. */
const MEMBERS: readonly string[] = ["usr_owner", "usr_admin", "usr_viewer"];

/** Every key the scenarios name, who made or holds it, and its organization if not ours. */
const KEYS = {
  vk_personal: { principalUserId: "usr_owner", createdById: "usr_owner" },
  vk_shared: { principalUserId: null, createdById: "usr_admin" },
  vk_foreign: { principalUserId: null, createdById: "usr_admin", organizationId: "org_2" },
} as const;

/** One request to the platform routes, made with the caller's key. */
type PlatformRequest = { method: string; path: string; body?: unknown };

/** The platform routes over a budget scoped to `usr_owner` and the keys above, for one API key. */
async function platformAs({ apiKeyId }: { apiKeyId: ApiKeyId }) {
  const store = MemoryGatewayStore.create();
  store.budgets.set(BUDGET_ID, budgetOf({ ownerId: "usr_owner" }));
  const { repositories } = new MemoryGatewayRepositories(store);
  for (const [id, owner] of Object.entries(KEYS)) {
    await repositories.virtualKeys.create({
      ...memoryVirtualKeySeed({ id, name: id, organizationId: ORG_ID }),
      ...owner,
    });
  }
  const app = await memoryGatewayApp({
    channels: MemoryGatewayChannels.create(),
    repositories,
    authz: createApiFixture<AuthzApi>({
      hasApiKeyPermission: async ({ apiKeyId: keyId, scope, permission }) => {
        const held: readonly string[] = API_KEYS[keyId as ApiKeyId].atOrganization;
        return scope.type === "org" && scope.id === ORG_ID && held.includes(permission);
      },
    }),
    projects: createApiFixture<ProjectApi>({
      listIdsByOrganization: async () => [PROJECT_ID],
      listTraceDestinations: async () => [],
    }),
    organizations: createApiFixture<OrganizationApi>({
      listGroupsForMember: async () => [],
      getMember: async ({ organizationId, userId }) => {
        if (!MEMBERS.includes(userId)) throw new MemberNotFoundError(userId);
        return {
          userId,
          organizationId,
          role: "MEMBER",
          disabledAt: null,
          createdAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
          updatedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
          user: { id: userId, name: userId, email: `${userId}@example.test` },
          teams: [],
        };
      },
    }),
  });
  const caller = {
    kind: "apiKey",
    apiKeyId,
    userId: API_KEYS[apiKeyId].userId,
    organizationId: ORG_ID,
  } as const;
  const door = () => ({
    actor: { type: "api_key" as const, id: apiKeyId },
    scope: { tier: "organization" as const, id: ORG_ID },
  });
  const hono = createRestRuntime({
    authorization: restTestAuthorization(),
    audit: { record: () => {} },
    identity: { authenticate: door, identify: door },
    doors: { api_key: { authenticate: door, identify: door } },
    idempotency: passthroughIdempotency,
  }).mount(gatewayPlatformRest.router(), {
    app: () => app,
    onError: canonicalErrorResponse,
    middlewareContext: [
      bindMiddlewareContext(gatewayRestCredential, () => caller),
      bindMiddlewareContext(gatewayKeyCaller, () => caller),
      bindMiddlewareContext(gatewayVirtualKeyCaller, () => caller),
    ],
  });

  return async ({ method, path, body }: PlatformRequest) => {
    const response = await hono.request(`/api/gateway/v1${path}`, {
      method,
      headers: { Authorization: "Bearer sk-lw-test", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as unknown };
  };
}

/** Reads, or writes with `write`, the budget at `/budgets/:id` as one API key. */
async function callAs({ apiKeyId }: { apiKeyId: ApiKeyId }) {
  const send = await platformAs({ apiKeyId });
  return ({ id = BUDGET_ID, write }: { id?: string; write?: BudgetWrite } = {}) =>
    send({
      method: write?.method ?? "GET",
      path: `/budgets/${id}${write?.suffix ?? ""}`,
      body: write?.body,
    });
}

/** Creates a budget on `scope` (the wire's snake spelling) as one API key. */
async function createAs({ apiKeyId, scope }: { apiKeyId: ApiKeyId; scope: object }) {
  const send = await platformAs({ apiKeyId });
  return send({
    method: "POST",
    path: "/budgets",
    body: { name: "created", scope, window: "month", limit_usd: "10" },
  });
}

describe("GET /budgets/:id, a budget scoped to one member", () => {
  /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
  it("answers a key acting for its owner", async () => {
    const read = await callAs({ apiKeyId: "ak_owner" });

    expect((await read()).status).toBe(200);
  });

  /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
  it("answers a key acting for an admin that holds the permission at the organization", async () => {
    const read = await callAs({ apiKeyId: "ak_admin" });

    expect((await read()).status).toBe(200);
  });

  /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
  it("answers a key acting for a viewer exactly as for a budget that does not exist", async () => {
    const read = await callAs({ apiKeyId: "ak_viewer" });

    const refused = await read();

    expect(refused.status).toBe(404);
    expect(refused).toEqual(await read({ id: "bdg_unknown" }));
  });

  /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
  it("answers an organization key with no user as not found, unless it holds the permission", async () => {
    const plain = await callAs({ apiKeyId: "ak_service" });
    const granted = await callAs({ apiKeyId: "ak_service_granted" });

    const refused = await plain();

    expect(refused.status).toBe(404);
    expect(refused).toEqual(await plain({ id: "bdg_unknown" }));
    expect((await granted()).status).toBe(200);
  });
});

describe("PATCH, DELETE and reset on /budgets/:id, a budget scoped to one member", () => {
  for (const [label, write] of Object.entries(WRITES)) {
    /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
    it(`answers a viewer's key's ${label} exactly as for a budget that does not exist`, async () => {
      const call = await callAs({ apiKeyId: "ak_viewer" });

      const refused = await call({ write });

      expect(refused.status).toBe(404);
      expect(refused).toEqual(await call({ id: "bdg_unknown", write }));
    });
  }
});

describe("POST /budgets, on one member or on a personal key", () => {
  const member = (id: string) => ({ kind: "principal", principal_user_id: id });
  const key = (id: string) => ({ kind: "virtual_key", virtual_key_id: id });

  /** @scenario "A budget on one person or on a personal key is created only by that person and those allowed to see other members' personal keys" */
  it("creates a member's budget for a key acting for that member", async () => {
    const created = await createAs({ apiKeyId: "ak_owner", scope: member("usr_owner") });

    expect(created.status).toBe(201);
  });

  /** @scenario "A budget on one person or on a personal key is created only by that person and those allowed to see other members' personal keys" */
  it("refuses an organization key with no user a member's budget, unless it holds the permission", async () => {
    const refused = await createAs({ apiKeyId: "ak_service", scope: member("usr_owner") });
    const granted = await createAs({ apiKeyId: "ak_service_granted", scope: member("usr_owner") });
    const absent = await createAs({ apiKeyId: "ak_service_granted", scope: member("usr_unknown") });

    expect(refused).toMatchObject({ status: 400, body: { code: "gateway_scope_org_mismatch" } });
    expect(refused).toEqual(absent);
    expect(granted.status).toBe(201);
  });

  /** @scenario "A budget on one person or on a personal key is created only by that person and those allowed to see other members' personal keys" */
  it("refuses a viewer's key a budget on another member's personal key, as for an unknown key", async () => {
    const refused = await createAs({ apiKeyId: "ak_viewer", scope: key("vk_personal") });
    const absent = await createAs({ apiKeyId: "ak_admin", scope: key("vk_unknown") });
    const own = await createAs({ apiKeyId: "ak_owner", scope: key("vk_personal") });

    expect(refused).toMatchObject({ status: 404, body: { code: "virtual_key_not_found" } });
    expect(refused).toEqual(absent);
    expect(own.status).toBe(201);
  });

  /** @scenario "A budget on one person or on a personal key is created only by that person and those allowed to see other members' personal keys" */
  it("refuses a key in another organization as an unknown key, and writes no budget", async () => {
    const send = await platformAs({ apiKeyId: "ak_viewer" });
    const create = (virtualKeyId: string) =>
      send({
        method: "POST",
        path: "/budgets",
        body: { name: "created", scope: key(virtualKeyId), window: "month", limit_usd: "10" },
      });

    const refused = await create("vk_foreign");
    const unknown = await create("vk_unknown");
    const listed = await send({ method: "GET", path: "/budgets" });

    expect(refused).toMatchObject({ status: 404, body: { code: "virtual_key_not_found" } });
    expect(refused).toEqual(unknown);
    expect(listed).toMatchObject({ status: 200, body: { data: [{ id: BUDGET_ID }] } });
    expect((listed.body as { data: unknown[] }).data).toHaveLength(1);
  });

  /** @scenario "A budget on one person or on a personal key is created only by that person and those allowed to see other members' personal keys" */
  it("creates a budget on a shared key for an organization key with no user", async () => {
    const created = await createAs({ apiKeyId: "ak_service", scope: key("vk_shared") });

    expect(created.status).toBe(201);
  });
});
