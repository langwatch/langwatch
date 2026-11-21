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
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { nowInstant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { GatewayModule } from "../../app/gateway.app.ts";
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

/** The platform routes over a budget scoped to `usr_owner`, called with one API key. */
async function callAs({ apiKeyId }: { apiKeyId: ApiKeyId }) {
  const store = MemoryGatewayStore.create();
  store.budgets.set(BUDGET_ID, budgetOf({ ownerId: "usr_owner" }));
  const { repositories } = new MemoryGatewayRepositories(store);
  const app = await GatewayModule.create({
    channels: MemoryGatewayChannels.create(),
    dependencies: {
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
      evaluators: createApiFixture({}),
      evaluations: createApiFixture({}),
      monitors: createApiFixture({}),
      organizations: createApiFixture<OrganizationApi>({ listGroupsForMember: async () => [] }),
      featureFlags: createApiFixture({}),
      modelProviders: createApiFixture({}),
      traces: createApiFixture({}),
      oneTimeReveals: createApiFixture({}),
      apiKeys: createApiFixture({}),
      licensing: createApiFixture({}),
    },
    repositories,
    config: {
      foldCacheTtlSeconds: 300,
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      publicBaseUrl: void 0,
      baseUrl: void 0,
      publicUrl: void 0,
      isSaas: false,
      allowLoopbackVoiceProviders: false,
    },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
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

  return async ({ id = BUDGET_ID, write }: { id?: string; write?: BudgetWrite } = {}) => {
    const response = await hono.request(`/api/gateway/v1/budgets/${id}${write?.suffix ?? ""}`, {
      method: write?.method ?? "GET",
      headers: { Authorization: "Bearer sk-lw-test", "Content-Type": "application/json" },
      ...(write?.body === undefined ? {} : { body: JSON.stringify(write.body) }),
    });
    return { status: response.status, body: (await response.json()) as unknown };
  };
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
