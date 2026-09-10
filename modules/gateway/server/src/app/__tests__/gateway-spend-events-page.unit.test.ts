/**
 * @vitest-environment node
 * `GatewayApp.findSpendEventsPage`: filter/cursor passthrough to the ledger
 * repository, virtual-key display-name resolution, and the ClickHouse-absent
 * degrade. The whole assembly used to live in the tRPC transport; it now
 * lives here so a REST door and the tRPC door read the same behaviour.
 */
import { Temporal } from "@langwatch/time";
import type { ProjectApi } from "@langwatch/project-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayApp, type GatewayAppDependencies } from "../gateway.app.ts";
import type { GatewaySpendEventsService } from "../../services/gateway-spend-events.service.ts";
import type { SpendEventRow } from "@langwatch/gateway-contract";

/** The slice of the application this surface reaches, and nothing else. */
function gatewayAppStub(dependencies: Partial<GatewayAppDependencies>): GatewayApp {
  return GatewayApp.create({
    dependencies: {},
    // `virtualKeys` is the discriminant GatewayApp uses to tell a full core
    // dependency bag from REST-only infrastructure; a stub exercising the
    // core app must carry the key even when this suite never reads it.
    infrastructure: { virtualKeys: {}, ...dependencies } as GatewayAppDependencies,
    config: undefined,
    resources: new ResourceScope(),
  });
}

function spendEventsStub(overrides: Partial<GatewaySpendEventsService>): GatewaySpendEventsService {
  return overrides as GatewaySpendEventsService;
}

function projectsStub(overrides: Partial<ProjectApi>): ProjectApi {
  return overrides as ProjectApi;
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
  occurredAt: Temporal.Instant.from("2026-07-20T12:00:00Z"),
};

const BASE_INPUT = {
  projectId: PROJECT_ID,
  fromMs: Date.parse("2026-07-01T00:00:00Z"),
  toMs: Date.parse("2026-07-29T00:00:00Z"),
};

const getSpendEventsPage = vi.fn();
const tryGetOrganizationId = vi.fn();
const resolveVirtualKeyNames = vi.fn();

function app({ clickHouse = true } = {}) {
  return gatewayAppStub({
    spendEvents: clickHouse ? spendEventsStub({ getSpendEventsPage }) : undefined,
    projects: projectsStub({ tryGetOrganizationId }),
    resolveVirtualKeyNames,
  });
}

describe("GatewayApp.findSpendEventsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSpendEventsPage.mockResolvedValue({ rows: [SPEND_ROW], nextCursor: null });
    tryGetOrganizationId.mockResolvedValue("org_1");
    resolveVirtualKeyNames.mockResolvedValue([{ id: "vk_1", name: "Customer A key" }]);
  });

  describe("given a page request carrying filters and a cursor", () => {
    /** @scenario Ledger filters and cursor pass through to the repository page read */
    it("passes filters and cursor through to the repository page read", async () => {
      await app().findSpendEventsPage({
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
    });
  });

  describe("given rows naming a virtual key", () => {
    /** @scenario Ledger rows resolve virtual key display names */
    it("resolves virtual-key display names alongside the rows", async () => {
      const result = await app().findSpendEventsPage(BASE_INPUT);

      expect(result?.rows).toHaveLength(1);
      expect(result?.virtualKeyNames).toEqual({ vk_1: "Customer A key" });
      expect(result?.clickHouseDisabled).toBe(false);
      expect(tryGetOrganizationId).toHaveBeenCalledWith(PROJECT_ID);
    });
  });

  describe("when the project resolves to no organization", () => {
    /** @scenario Unknown project tenants do not resolve virtual-key names */
    it("keeps virtual-key names empty", async () => {
      tryGetOrganizationId.mockResolvedValue(undefined);

      const result = await app().findSpendEventsPage(BASE_INPUT);

      expect(result?.virtualKeyNames).toEqual({});
      expect(resolveVirtualKeyNames).not.toHaveBeenCalled();
    });
  });

  describe("when the deployment has no ClickHouse spend path", () => {
    /** @scenario The ledger read answers null without ClickHouse */
    it("answers null", async () => {
      const result = await app({ clickHouse: false }).findSpendEventsPage(BASE_INPUT);

      expect(result).toBeNull();
      expect(getSpendEventsPage).not.toHaveBeenCalled();
    });
  });
});
