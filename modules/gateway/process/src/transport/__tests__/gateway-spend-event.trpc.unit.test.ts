import { createApiFixture } from "@langwatch/api-fixture";
import { createTrpcRuntime, type TrpcRuntimeMembers } from "@langwatch/api/trpc";
/**
 * @vitest-environment node
 * The `gatewaySpendEvents.list` transport is a thin handler over
 * `GatewayApp.listSpendEventsPage`, pinning only the wiring and shape.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { ResourceScope } from "@langwatch/kernel";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { Encryption } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayApp } from "../../app/gateway.app.ts";
import { gatewaySpendEventTrpcTransport } from "../gateway-spend-event.trpc.ts";

type GatewayTrpcTestContext = { actor: { id: string } };

/** The process members a mounted declaration runs on, as this suite supplies them. */
function testPorts(
  permits: (permission: AuthzPermission) => boolean = () => true,
): TrpcRuntimeMembers<GatewayTrpcTestContext> {
  return {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission }) => ({
          permitted: permits(permission),
          organizationRole: null,
        }),
        getProjectAnyDecision: async ({ permissions }) => ({
          permitted: permissions.some((permission) => permits(permission)),
          organizationRole: null,
        }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
}

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

const SPEND_EVENT_ROW = {
  TenantId: "project_1",
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

/** A fake ClickHouse client answering one row of the spend ledger. */
function fakeClickHouse(): ClickHouseQueryClient {
  return clickHouseQueryClientDouble({
    query: clickHouseQuery,
    insert: async () => {},
  });
}

/** A fake Prisma client answering the one virtual-key display-name lookup. */
function fakePrisma(): PrismaClient {
  return prismaDouble({
    virtualKey: {
      findMany: async () => [{ id: "vk_1", name: "Customer A key", displayPrefix: "..." }],
    },
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
      projects: projectsStub({ findOrganizationId: async () => "org_1" }),
      evaluators: peer("evaluators"),
      monitors: peer("monitors"),
      organizations: peer("organizations"),
      featureFlags: peer("featureFlags"),
      modelProviders: peer("modelProviders"),
      traces: peer("traces"),
      oneTimeReveals: peer("oneTimeReveals"),
    },
    members: {
      prisma: fakePrisma(),
      clickhouse: fakeClickHouse(),
      gatewayInternalProtocol: {},
      encryption: createApiFixture<Encryption>(),
    },
    config: {
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      baseUrl: undefined,
      publicUrl: undefined,
      isSaas: false,
    },
    resources: new ResourceScope(),
    secrets: noSecrets,
  });
}

const BASE_INPUT = {
  projectId: "project_1",
  fromMs: Date.parse("2026-07-01T00:00:00Z"),
  toMs: Date.parse("2026-07-29T00:00:00Z"),
};

async function caller(permits?: (permission: AuthzPermission) => boolean) {
  const app = await gatewayAppStub();
  const trpc = initTRPC.context<GatewayTrpcTestContext>().create();
  const router = createTrpcRuntime<GatewayTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: testPorts(permits),
  }).mount(gatewaySpendEventTrpcTransport, () => app);

  return router.createCaller({ actor: { id: "usr_1" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  clickHouseQuery.mockResolvedValue({ rows: [SPEND_EVENT_ROW] });
});

describe("gatewaySpendEvents.list", () => {
  describe("given the caller holds gatewayUsage:view", () => {
    /** @scenario Ledger rows resolve virtual key display names */
    /** @scenario "Spend history is served with no ClickHouse-absent degrade path" */
    it("answers the page the application resolved", async () => {
      const result = await (await caller()).list(BASE_INPUT);

      expect(result.virtualKeyNames).toEqual({ vk_1: "Customer A key" });
      expect(result.clickHouseDisabled).toBe(false);
      expect(clickHouseQuery).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: BASE_INPUT.projectId }),
      );
    });
  });

  describe("when the caller lacks gatewayUsage:view", () => {
    /** @scenario The ledger requires the gateway usage view scope */
    it("never reaches the application", async () => {
      await expect((await caller(() => false)).list(BASE_INPUT)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(clickHouseQuery).not.toHaveBeenCalled();
    });
  });
});
