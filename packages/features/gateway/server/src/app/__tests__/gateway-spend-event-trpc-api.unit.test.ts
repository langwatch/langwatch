/**
 * @vitest-environment node
 *
 * The `gatewaySpendEvents` transport: filter and cursor passthrough to the
 * repository page read, virtual-key display-name resolution, the
 * ClickHouse-absent degrade, and the declared scope.
 *
 * Moved here with the surface itself. The refusal case now stands on the
 * policy the process hands in rather than on the app's RBAC middleware — the
 * transport's side of that contract is that the handler never runs when the
 * policy refuses, which is what is asserted.
 */
import type { ProjectService } from "@langwatch/project-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpendEventRow } from "../../repositories/clickhouse/clickhouse.gateway-spend-events.repository";
import { GatewaySpendEventTrpcApi } from "../../transport/api-trpc/gateway-spend-event.api";
import { GatewayApp, type GatewayAppDependencies } from "../gateway.app";
import type { GatewaySpendEventsService } from "../../services/gateway-spend-events.service";

/** The slice of the application this surface reaches, and nothing else. */
function gatewayAppStub(dependencies: Partial<GatewayAppDependencies>): GatewayApp {
  return GatewayApp.create(dependencies as GatewayAppDependencies);
}

function spendEventsStub(
  overrides: Partial<GatewaySpendEventsService>,
): GatewaySpendEventsService {
  return overrides as GatewaySpendEventsService;
}

function projectsStub(overrides: Partial<ProjectService>): ProjectService {
  return overrides as ProjectService;
}

const PROJECT_ID = "project_1";

const SPEND_ROW: SpendEventRow = {
  tenantId: PROJECT_ID,
  gatewayRequestId: "req_1",
  organizationId: "org_1",
  teamId: "team_1",
  virtualKeyId: "vk_1",
  principalUserId: "",
  endUserId: "enduser-9",
  traceId: "trace_1",
  model: "gpt-5",
  providerKey: "prov_1",
  tokensInput: 100,
  tokensOutput: 50,
  tokensCacheRead: 0,
  tokensCacheWrite: 0,
  tokensReasoning: 0,
  costUsd: "0.001200",
  status: "confirmed" as const,
  requestType: "chat",
  costNanoUsd: 4_200_000,
  rateVersion: "catalog@2026-07-26",
  needsReconciliation: false,
  settleReason: "",
  errorClass: "",
  httpStatus: 200,
  labels: [],
  metadata: "",
  durationMs: 900,
  occurredAt: new Date("2026-07-20T12:00:00Z"),
};

const BASE_INPUT = {
  projectId: PROJECT_ID,
  fromMs: Date.parse("2026-07-01T00:00:00Z"),
  toMs: Date.parse("2026-07-29T00:00:00Z"),
};

const getSpendEventsPage = vi.fn();
const tryGetOrganizationId = vi.fn();
const resolveVirtualKeyNames = vi.fn();
const seenPermissions: string[] = [];
const denied = new Set<string>();

function harness({ clickHouse = true } = {}) {
  const trpc = initTRPC
    .context<{
      app: { gateway: GatewayApp };
      actor(): { id: string };
    }>()
    .create();

  const router = GatewaySpendEventTrpcApi.create(trpc, {
    protected: trpc.procedure,
    // Stands in for the process's chain: it records the declared permission
    // and refuses before the handler, exactly where the real check sits.
    policy: (permission) => (procedure) =>
      (procedure as { use(m: unknown): unknown }).use(({ next }: { next: () => unknown }) => {
        seenPermissions.push(permission);
        if (denied.has(permission)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission" });
        }
        return next();
      }) as typeof procedure,
  });

  return router.createCaller({
    app: {
      gateway: gatewayAppStub({
        spendEvents: clickHouse ? spendEventsStub({ getSpendEventsPage }) : undefined,
        projects: projectsStub({ tryGetOrganizationId }),
        resolveVirtualKeyNames,
      }),
    },
    actor: () => ({ id: "user_1" }),
  });
}

describe("GatewaySpendEventTrpcApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seenPermissions.length = 0;
    denied.clear();
    getSpendEventsPage.mockResolvedValue({ rows: [SPEND_ROW], nextCursor: null });
    tryGetOrganizationId.mockResolvedValue("org_1");
    resolveVirtualKeyNames.mockResolvedValue([{ id: "vk_1", name: "Customer A key" }]);
  });

  describe("given a page request carrying filters and a cursor", () => {
    /** @scenario Ledger filters and cursor pass through to the repository page read */
    it("passes filters and cursor through to the repository page read", async () => {
      await harness().list({
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

      expect(getSpendEventsPage).toHaveBeenCalledWith({
        tenantId: PROJECT_ID,
        fromMs: BASE_INPUT.fromMs,
        toMs: BASE_INPUT.toMs,
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
      expect(seenPermissions).toEqual(["gatewayUsage:view"]);
    });
  });

  describe("given rows naming a virtual key", () => {
    /** @scenario Ledger rows resolve virtual key display names */
    it("resolves virtual-key display names alongside the rows", async () => {
      const result = await harness().list(BASE_INPUT);

      expect(result.rows).toHaveLength(1);
      expect(result.virtualKeyNames).toEqual({ vk_1: "Customer A key" });
      expect(result.clickHouseDisabled).toBe(false);
      expect(tryGetOrganizationId).toHaveBeenCalledWith(PROJECT_ID);
    });
  });

  describe("when the project resolves to no organization", () => {
    /** @scenario Unknown project tenants do not resolve virtual-key names */
    it("keeps virtual-key names empty", async () => {
      tryGetOrganizationId.mockResolvedValue(undefined);

      const result = await harness().list(BASE_INPUT);

      expect(result.virtualKeyNames).toEqual({});
      expect(resolveVirtualKeyNames).not.toHaveBeenCalled();
    });
  });

  describe("when the deployment has no ClickHouse spend path", () => {
    /** @scenario The ledger degrades to an empty page without ClickHouse */
    it("degrades to an empty page", async () => {
      const result = await harness({ clickHouse: false }).list(BASE_INPUT);

      expect(result).toMatchObject({ rows: [], nextCursor: null, clickHouseDisabled: true });
      expect(getSpendEventsPage).not.toHaveBeenCalled();
    });
  });

  describe("when the policy refuses the declared scope", () => {
    /** @scenario The ledger requires the gateway usage view scope */
    it("never reaches the repository", async () => {
      denied.add("gatewayUsage:view");

      await expect(harness().list(BASE_INPUT)).rejects.toThrow("You do not have permission");
      expect(getSpendEventsPage).not.toHaveBeenCalled();
    });
  });
});
