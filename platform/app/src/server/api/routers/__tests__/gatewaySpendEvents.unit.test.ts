/**
 * Unit tests for the gatewaySpendEvents tRPC router: filter and cursor
 * passthrough to the repository, virtual-key display-name resolution, the
 * ClickHouse-disabled degrade, and RBAC denial.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import type { SpendEventRow } from "~/server/gateway/spendEvents.clickhouse.repository";
import { createInnerTRPCContext } from "../../trpc";
import { gatewaySpendEventsRouter } from "../gatewaySpendEvents";

const PROJECT_ID = "project_1";

const seenPermissions: string[] = [];
const denied = new Set<string>();

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    resolveProjectPermission: vi.fn(
      async (_ctx: unknown, _projectId: string, permission: string) => {
        seenPermissions.push(permission);
        return {
          permitted: !denied.has(permission),
          organizationRole: "MEMBER",
        };
      },
    ),
  };
});

const readSpendEventsPage = vi.hoisted(() => vi.fn());

// The router takes the spend-events repository from the App, so standing
// in for the store means standing in for `getApp()`. `current` toggles
// between the repository and undefined to stand in for a deployment
// without ClickHouse.
const spendEventsRepository = vi.hoisted(() => ({
  current: undefined as
    | { readSpendEventsPage: typeof readSpendEventsPage }
    | undefined,
}));
vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsService } = await import(
    "~/test-utils/appPermissionsMock"
  );
  return {
    // Consumers that degrade without Redis read through this one.
    tryGetApp: () => null,
    getApp: () => ({
      permissions: appPermissionsService(),
      gateway: { spendEvents: spendEventsRepository.current },
    }),
  };
});

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

function buildCaller() {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user_1" }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: false,
    publiclyShared: false,
  });
  ctx.prisma = {
    project: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ team: { organizationId: "org_1" } }),
    },
    virtualKey: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: "vk_1", name: "Customer A key" }]),
    },
  } as unknown as PrismaClient;
  return gatewaySpendEventsRouter.createCaller(ctx);
}

const BASE_INPUT = {
  projectId: PROJECT_ID,
  fromMs: Date.parse("2026-07-01T00:00:00Z"),
  toMs: Date.parse("2026-07-29T00:00:00Z"),
};

describe("gatewaySpendEventsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seenPermissions.length = 0;
    denied.clear();
    spendEventsRepository.current = { readSpendEventsPage };
    readSpendEventsPage.mockResolvedValue({
      rows: [SPEND_ROW],
      nextCursor: null,
    });
  });

  /** @scenario Ledger filters and cursor pass through to the repository page read */
  it("passes filters and cursor through to the repository page read", async () => {
    const caller = buildCaller();
    await caller.list({
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
    expect(readSpendEventsPage).toHaveBeenCalledWith({
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

  /** @scenario Ledger rows resolve virtual key display names */
  it("resolves virtual-key display names alongside the rows", async () => {
    const caller = buildCaller();
    const result = await caller.list(BASE_INPUT);
    expect(result.rows).toHaveLength(1);
    expect(result.virtualKeyNames).toEqual({ vk_1: "Customer A key" });
    expect(result.clickHouseDisabled).toBe(false);
  });

  /** @scenario The ledger degrades to an empty page without ClickHouse */
  it("degrades to an empty page when ClickHouse is disabled", async () => {
    spendEventsRepository.current = undefined;
    const caller = buildCaller();
    const result = await caller.list(BASE_INPUT);
    expect(result).toMatchObject({
      rows: [],
      nextCursor: null,
      clickHouseDisabled: true,
    });
    expect(readSpendEventsPage).not.toHaveBeenCalled();
  });

  /** @scenario The ledger requires the gateway usage view scope */
  it("denies without the gateway usage view scope", async () => {
    denied.add("gatewayUsage:view");
    const caller = buildCaller();
    await expect(caller.list(BASE_INPUT)).rejects.toThrow(
      "You do not have permission",
    );
    expect(readSpendEventsPage).not.toHaveBeenCalled();
  });
});
