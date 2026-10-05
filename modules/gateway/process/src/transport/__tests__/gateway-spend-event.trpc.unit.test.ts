import { createTrpcRuntime } from "@langwatch/api/trpc";
/**
 * @vitest-environment node
 * The `gatewaySpendEvents.list` transport is a thin handler over
 * `GatewayModule.listSpendEventsPage`, pinning only the wiring and shape.
 */
import type { AuthzPermission } from "@langwatch/authorization";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  memorySpendStateSeed,
  memoryVirtualKeySeed,
} from "../../__tests__/support/gateway-memory-seeds.fixture.ts";
import { GatewayModule } from "../../app/gateway.app.ts";
import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import { gatewaySpendEventTrpcTransport } from "../gateway-spend-event.trpc.ts";

type GatewayTrpcTestContext = { actor: { id: string } };

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

/** One settled request on the ledger, naming a key the organization holds. */
async function seededRepositories() {
  const repositories = MemoryGatewayRepositories.create();
  await repositories.virtualKeys.create(
    memoryVirtualKeySeed({ id: "vk_1", name: "Customer A key", organizationId: "org_1" }),
  );
  await repositories.spendEvents.upsertFromFold([
    { tenantId: "project_1", gatewayRequestId: "req_1", state: memorySpendStateSeed() },
  ]);
  return repositories;
}

/** No handle is ever resolved through it in these tests. */
const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

/** The gateway over seeded memory twins, with its ledger page read watched. */
async function gatewayAppStub() {
  const repositories = await seededRepositories();
  const pageReads = vi.spyOn(repositories.spendEvents, "readSpendEventsPage");
  const app = await GatewayModule.create({
    dependencies: {
      entitlement: peer("entitlement"),
      authz: peer("authz"),
      projects: projectsStub({ findOrganizationId: async () => "org_1" }),
      evaluators: peer("evaluators"),
      evaluations: peer("evaluations"),
      monitors: peer("monitors"),
      organizations: peer("organizations"),
      featureFlags: peer("featureFlags"),
      modelProviders: peer("modelProviders"),
      traces: peer("traces"),
      oneTimeReveals: peer("oneTimeReveals"),
      apiKeys: peer("apiKeys"),
    },
    repositories,
    config: {
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      publicBaseUrl: void 0,
      baseUrl: undefined,
      publicUrl: undefined,
      isSaas: false,
      allowLoopbackVoiceProviders: false,
    },
    resources: new ResourceScope(),
    secrets: noSecrets,
  });
  return { app, pageReads };
}

const BASE_INPUT = {
  projectId: "project_1",
  fromMs: Date.parse("2026-07-01T00:00:00Z"),
  toMs: Date.parse("2026-07-29T00:00:00Z"),
};

async function caller(permits?: (permission: AuthzPermission) => boolean) {
  const { app, pageReads } = await gatewayAppStub();
  const trpc = initTRPC.context<GatewayTrpcTestContext>().create();
  const router = createTrpcRuntime<GatewayTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<GatewayTrpcTestContext>({ permits }),
  }).mount(gatewaySpendEventTrpcTransport, () => app);

  return { procedures: router.createCaller({ actor: { id: "usr_1" } }), pageReads };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("gatewaySpendEvents.list", () => {
  describe("given the caller holds gatewayUsage:view", () => {
    /** @scenario Ledger rows resolve virtual key display names */
    /** @scenario "Spend history is served with no ClickHouse-absent degrade path" */
    it("answers the page the application resolved", async () => {
      const { procedures, pageReads } = await caller();
      const result = await procedures.list(BASE_INPUT);

      expect(result.rows).toHaveLength(1);
      expect(result.virtualKeyNames).toEqual({ vk_1: "Customer A key" });
      expect(result.clickHouseDisabled).toBe(false);
      expect(pageReads).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: BASE_INPUT.projectId }),
      );
    });
  });

  describe("when the caller lacks gatewayUsage:view", () => {
    /** @scenario The ledger requires the gateway usage view scope */
    it("never reaches the application", async () => {
      const { procedures, pageReads } = await caller(() => false);

      await expect(procedures.list(BASE_INPUT)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(pageReads).not.toHaveBeenCalled();
    });
  });
});
