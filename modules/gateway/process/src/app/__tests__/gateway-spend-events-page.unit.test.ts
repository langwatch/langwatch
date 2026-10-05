/**
 * @vitest-environment node
 * `GatewayModule.listSpendEventsPage`: ledger read, filter/cursor passthrough,
 * virtual-key display-name resolution — moved here so REST and tRPC agree.
 */
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  memorySpendStateSeed,
  memoryVirtualKeySeed,
} from "../../__tests__/support/gateway-memory-seeds.fixture.ts";
import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import { GatewayModule } from "../gateway.app.ts";

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

const findOrganizationId = vi.fn();

/** One settled request on the ledger, naming the key it was spent through. */
async function seededRepositories({ virtualKeyId }: { virtualKeyId: string }) {
  const repositories = MemoryGatewayRepositories.create();
  await repositories.virtualKeys.create(
    memoryVirtualKeySeed({ id: "vk_1", name: "Customer A key", organizationId: "org_1" }),
  );
  await repositories.spendEvents.upsertFromFold([
    {
      tenantId: PROJECT_ID,
      gatewayRequestId: "req_1",
      state: memorySpendStateSeed({ virtualKeyId }),
    },
  ]);
  return repositories;
}

/** No handle is ever resolved through it in these tests. */
const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

/** The gateway over seeded memory twins, with the ledger page and key-name reads watched. */
async function gatewayAppStub({ virtualKeyId = "vk_1" }: { virtualKeyId?: string } = {}) {
  const repositories = await seededRepositories({ virtualKeyId });
  const pageReads = vi.spyOn(repositories.spendEvents, "readSpendEventsPage");
  const nameReads = vi.spyOn(repositories.virtualKeys, "findMetaByIds");
  const app = await GatewayModule.create({
    dependencies: {
      entitlement: peer("entitlement"),
      authz: peer("authz"),
      projects: projectsStub({ findOrganizationId }),
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
  return { app, pageReads, nameReads };
}

const BASE_INPUT = {
  projectId: PROJECT_ID,
  fromMs: Date.parse("2026-07-01T00:00:00Z"),
  toMs: Date.parse("2026-07-29T00:00:00Z"),
};

describe("GatewayModule.listSpendEventsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findOrganizationId.mockResolvedValue("org_1");
  });

  describe("given a page request carrying filters and a cursor", () => {
    /** @scenario Ledger filters and cursor pass through to the repository page read */
    it("passes filters and cursor through to the repository page read", async () => {
      const { app, pageReads } = await gatewayAppStub();
      const filters = {
        virtualKeyIds: ["vk_1"],
        endUserIds: ["enduser-9"],
        models: ["gpt-5"],
        providerKeys: ["pk-openai"],
        labels: ["billable"],
        metadata: [{ key: "customer_tier", values: ["gold"] }],
        status: "error" as const,
      };
      await app.listSpendEventsPage({
        ...BASE_INPUT,
        filters,
        cursor: { occurredAtMs: 123, gatewayRequestId: "req_0" },
        limit: 25,
      });

      expect(pageReads).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: PROJECT_ID,
          fromMs: BASE_INPUT.fromMs,
          toMs: BASE_INPUT.toMs,
          filters: expect.objectContaining(filters),
          cursor: { occurredAtMs: 123, gatewayRequestId: "req_0" },
          limit: 25,
        }),
      );
    });
  });

  describe("given rows naming a virtual key", () => {
    /** @scenario Ledger rows resolve virtual key display names */
    /** @scenario Virtual key rows are read only through the gateway feature */
    it("resolves virtual-key display names alongside the rows", async () => {
      const { app, nameReads } = await gatewayAppStub();
      const result = await app.listSpendEventsPage(BASE_INPUT);

      expect(result?.rows).toHaveLength(1);
      expect(result?.virtualKeyNames).toEqual({ vk_1: "Customer A key" });
      expect(result?.clickHouseDisabled).toBe(false);
      expect(findOrganizationId).toHaveBeenCalledWith(PROJECT_ID);
      expect(nameReads).toHaveBeenCalledWith({ organizationId: "org_1", ids: ["vk_1"] });
    });
  });

  describe("given a page naming no keys", () => {
    it("asks the virtual-key table nothing", async () => {
      const { app, nameReads } = await gatewayAppStub({ virtualKeyId: "" });

      const result = await app.listSpendEventsPage(BASE_INPUT);

      expect(result?.rows).toHaveLength(1);
      expect(result?.virtualKeyNames).toEqual({});
      expect(nameReads).not.toHaveBeenCalled();
    });
  });

  describe("when the project resolves to no organization", () => {
    /** @scenario Unknown project tenants do not resolve virtual-key names */
    it("keeps virtual-key names empty", async () => {
      findOrganizationId.mockResolvedValue(undefined);
      const { app, nameReads } = await gatewayAppStub();

      const result = await app.listSpendEventsPage(BASE_INPUT);

      expect(result?.virtualKeyNames).toEqual({});
      expect(nameReads).not.toHaveBeenCalled();
    });
  });
});
