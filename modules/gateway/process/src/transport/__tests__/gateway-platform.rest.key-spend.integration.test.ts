/**
 * A key's spend read over REST on the real application and its memory twins, with the trace
 * module answering from the traces it holds: the route and the keys table take one figure.
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
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
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
const VIRTUAL_KEY_ATTRIBUTE = "langwatch.virtual_key_id";

const secrets = new ScopedSecrets(async (handle, build) =>
  build(handle.id === "LW_VIRTUAL_KEY_PEPPER" ? "test-virtual-key-pepper" : undefined),
);

const wire = z.looseObject({
  virtual_key_id: z.string(),
  spent_usd: z.string(),
  requests: z.number(),
});

const passthroughIdempotency: IdempotentRunner = async ({ handler }) => {
  const response = await handler();
  return { isReplayed: false, status: response.status, response };
};

/** The traces in trace_summaries: each costs what it costs and carries the key's id. */
function traceSummaries(costs: string[]) {
  const findSpendByAttributeValue = vi.fn<TraceApi["findSpendByAttributeValue"]>(
    async ({ projectId, attributeKey, values }) => {
      if (projectId !== PROJECT_ID || attributeKey !== VIRTUAL_KEY_ATTRIBUTE) return [];
      if (!values.includes(KEY_ID)) return [];
      const cents = costs.reduce((sum, cost) => sum + Math.round(Number(cost) * 100), 0);
      return [{ value: KEY_ID, spentUsd: (cents / 100).toString(), requests: costs.length }];
    },
  );
  return { findSpendByAttributeValue };
}

async function mountedSpendRead({ costs }: { costs: string[] }) {
  const { findSpendByAttributeValue } = traceSummaries(costs);
  const store = MemoryGatewayStore.create({
    teams: [{ id: "team_1", organizationId: ORGANIZATION_ID, name: "Platform", slug: "platform" }],
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
      }),
      evaluators: createApiFixture({}),
      evaluations: createApiFixture({}),
      monitors: createApiFixture({}),
      organizations: createApiFixture<OrganizationApi>({
        getMember: async ({ organizationId, userId }) => ({
          userId,
          organizationId,
          role: "ADMIN",
          disabledAt: null,
          createdAt: nowInstant(),
          updatedAt: nowInstant(),
          user: { id: userId, name: null, email: null },
          teams: [],
        }),
        findMemberTeamIds: async () => [],
      }),
      featureFlags: createApiFixture({}),
      modelProviders: createApiFixture({}),
      traces: createApiFixture<TraceApi>({ findSpendByAttributeValue }),
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
    getVirtualKeyForCaller: async ({ id }) =>
      real.getExistingVirtualKey({ organizationId: ORGANIZATION_ID, id }),
    getVirtualKeySpend: (input) => real.getVirtualKeySpend(input),
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
  const readSpend = async () => {
    const response = await hono.request(`/api/gateway/v1/virtual-keys/${KEY_ID}/spend`, {
      headers: { Authorization: "Bearer sk-lw-test" },
    });
    return { status: response.status, body: wire.parse(await response.json()) };
  };
  return { readSpend, real, findSpendByAttributeValue };
}

describe("given two traces for the key in trace_summaries costing 0.75 and 0.50", () => {
  /** @scenario Key spend over REST reads the same trace_summaries the UI reads */
  it("answers their sum and count, the figure the keys table shows for the same key", async () => {
    const { readSpend, real, findSpendByAttributeValue } = await mountedSpendRead({
      costs: ["0.75", "0.50"],
    });

    const answer = await readSpend();
    const keysTable = await real.listVirtualKeySpendThisMonth({
      organizationId: ORGANIZATION_ID,
      userId: "admin_1",
    });

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ virtual_key_id: KEY_ID, spent_usd: "1.25", requests: 2 });
    expect(findSpendByAttributeValue).toHaveBeenCalledWith(
      expect.objectContaining({ attributeKey: VIRTUAL_KEY_ATTRIBUTE, values: [KEY_ID] }),
    );
    expect(keysTable).toEqual([
      expect.objectContaining({ virtualKeyId: KEY_ID, spentUsd: "1.25", requests: 2 }),
    ]);
  });
});
