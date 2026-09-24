import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 * `GatewayApp.listSpendEventsPage`: ledger read, filter/cursor passthrough,
 * virtual-key display-name resolution — moved here so REST and tRPC agree.
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { ResourceScope } from "@langwatch/kernel";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { Encryption } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayApp } from "../gateway.app.ts";

/** A peer that answers nothing: the composition resolves it, no test call reaches it. */
function peer(name: string): never {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === "symbol") return undefined;
        throw new Error(`The ${name} peer was called for "${String(property)}".`);
      },
    },
  ) as never;
}

function projectsStub(overrides: Partial<ProjectApi>): ProjectApi {
  return overrides as ProjectApi;
}

const PROJECT_ID = "project_1";

const SPEND_EVENT_ROW = {
  TenantId: PROJECT_ID,
  GatewayRequestId: "req_1",
  OrganizationId: "org_1",
  VirtualKeyId: "vk_1",
  PrincipalUserId: "",
  EndUserId: "enduser-9",
  TraceId: "trace_1",
  Model: "gpt-5",
  ProviderKey: "prov_1",
  RequestType: "chat",
  TokensInput: 100,
  TokensOutput: 50,
  TokensCacheRead: 0,
  TokensCacheWrite: 0,
  TokensReasoning: 0,
  CostNanoUSD: 4_200_000,
  RateVersion: "catalog@2026-07-26",
  Status: "confirmed",
  ErrorClass: "",
  HttpStatus: 200,
  NeedsReconciliation: 0,
  SettleReason: "",
  Labels: [] as string[],
  Metadata: "",
  DurationMS: 900,
  OccurredAtMs: Date.parse("2026-07-20T12:00:00Z"),
};

const clickHouseQuery = vi.fn();
const findOrganizationId = vi.fn();
const virtualKeyFindMany = vi.fn();

/** A fake ClickHouse client answering the spend ledger page read. */
function fakeClickHouse(): ClickHouseQueryClient {
  return clickHouseQueryClientDouble({
    query: clickHouseQuery,
    insert: async () => {},
  });
}

/** A fake Prisma client answering the one virtual-key display-name lookup. */
function fakePrisma(): PrismaClient {
  return prismaDouble({
    virtualKey: { findMany: virtualKeyFindMany },
  });
}

/** No handle is ever resolved through it in these tests. */
const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

/** The slice of the application this surface reaches, and nothing else. */
async function gatewayAppStub(): Promise<GatewayApp> {
  return GatewayApp.create({
    dependencies: {
      webhooks: peer("webhooks"),
      entitlement: peer("entitlement"),
      authz: peer("authz"),
      projects: projectsStub({ findOrganizationId }),
      evaluators: peer("evaluators"),
      monitors: peer("monitors"),
      organizations: peer("organizations"),
      featureFlags: peer("featureFlags"),
      modelProviders: peer("modelProviders"),
    },
    members: {
      prisma: fakePrisma(),
      clickhouse: fakeClickHouse(),
      elevenLabsWebhook: void 0,
      gatewayInternalProtocol: {},
      encryption: createApiFixture<Encryption>(),
    },
    config: {
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      baseUrl: undefined,
      publicUrl: undefined,
    },
    resources: new ResourceScope(),
    secrets: noSecrets,
  });
}

const BASE_INPUT = {
  projectId: PROJECT_ID,
  fromMs: Date.parse("2026-07-01T00:00:00Z"),
  toMs: Date.parse("2026-07-29T00:00:00Z"),
};

describe("GatewayApp.listSpendEventsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clickHouseQuery.mockResolvedValue({ rows: [SPEND_EVENT_ROW] });
    findOrganizationId.mockResolvedValue("org_1");
    virtualKeyFindMany.mockResolvedValue([
      { id: "vk_1", name: "Customer A key", displayPrefix: "..." },
    ]);
  });

  describe("given a page request carrying filters and a cursor", () => {
    /** @scenario Ledger filters and cursor pass through to the repository page read */
    it("passes filters and cursor through to the repository page read", async () => {
      const app = await gatewayAppStub();
      await app.listSpendEventsPage({
        ...BASE_INPUT,
        filters: {
          virtualKeyIds: ["vk_1"],
          endUserIds: ["enduser-9"],
          models: ["gpt-5"],
          providerKeys: ["pk-openai"],
          labels: ["billable"],
          metadata: [{ key: "customer_tier", values: ["gold"] }],
          status: "error",
        },
        cursor: { occurredAtMs: 123, gatewayRequestId: "req_0" },
        limit: 25,
      });

      expect(clickHouseQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: PROJECT_ID,
          params: expect.objectContaining({
            tenantId: PROJECT_ID,
            fromMs: BASE_INPUT.fromMs,
            toMs: BASE_INPUT.toMs,
            limit: 25,
            cursorOccurredAtMs: 123,
            cursorRequestId: "req_0",
          }),
        }),
      );
    });
  });

  describe("given rows naming a virtual key", () => {
    /** @scenario Ledger rows resolve virtual key display names */
    it("resolves virtual-key display names alongside the rows", async () => {
      const app = await gatewayAppStub();
      const result = await app.listSpendEventsPage(BASE_INPUT);

      expect(result?.rows).toHaveLength(1);
      expect(result?.virtualKeyNames).toEqual({ vk_1: "Customer A key" });
      expect(result?.clickHouseDisabled).toBe(false);
      expect(findOrganizationId).toHaveBeenCalledWith(PROJECT_ID);
      expect(virtualKeyFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: "org_1", id: { in: ["vk_1"] } }),
        }),
      );
    });
  });

  describe("when the project resolves to no organization", () => {
    /** @scenario Unknown project tenants do not resolve virtual-key names */
    it("keeps virtual-key names empty", async () => {
      findOrganizationId.mockResolvedValue(undefined);
      const app = await gatewayAppStub();

      const result = await app.listSpendEventsPage(BASE_INPUT);

      expect(result?.virtualKeyNames).toEqual({});
      expect(virtualKeyFindMany).not.toHaveBeenCalled();
    });
  });
});
