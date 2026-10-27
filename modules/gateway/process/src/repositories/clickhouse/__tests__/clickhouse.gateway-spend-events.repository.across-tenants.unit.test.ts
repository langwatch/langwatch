/**
 * Spec: modules/webhook/specs/webhook-spend-events-read.feature,
 * specs/webhooks/webhook-endpoints.feature
 */
import { describe, expect, it } from "vitest";

import * as spendCursors from "../../../rules/gateway-spend-cursor.rules.ts";
import { ClickHouseGatewaySpendEventsRepository } from "../clickhouse.gateway-spend-events.repository.ts";

type Statement = { tenantId: string; sql: string; params: Record<string, unknown> };

function spendRow({
  tenant,
  id,
  atMs,
  status = "confirmed",
}: {
  tenant: string;
  id: string;
  atMs: number;
  status?: string;
}) {
  return {
    TenantId: tenant,
    GatewayRequestId: id,
    OrganizationId: "org-1",
    VirtualKeyId: "vk-1",
    Status: status,
    CostNanoUSD: 0,
    OccurredAtMs: atMs,
  };
}

/** Answers a tenant's rows in the asked statuses; refuses a statement not scoped to it. */
function routedRepository(rowsByTenant: Record<string, ReturnType<typeof spendRow>[]>) {
  const statements: Statement[] = [];
  const repository = ClickHouseGatewaySpendEventsRepository.create(async (tenantId) => ({
    async query({ query, query_params = {} }) {
      statements.push({ tenantId, sql: query, params: query_params });
      if (!/TenantId = \{tenantId:String\}/.test(query) || query_params.tenantId !== tenantId) {
        throw new Error(`statement is not scoped to its routed tenant ${tenantId}`);
      }
      const statuses = query_params.statuses as string[];
      const rows = (rowsByTenant[tenantId] ?? []).filter((row) => statuses.includes(row.Status));
      return { json: async <T>() => rows as T[] };
    },
    insert: async () => undefined,
  }));
  return { repository, statements };
}

describe("the spend-event reads across tenants", () => {
  /** @scenario "Every emitted-events statement names exactly one tenant" */
  /** @scenario "Gateway pages spend events across tenants newest first by status" */
  it("reads each project with its own tenant-scoped statement and merges newest first", async () => {
    const { repository, statements } = routedRepository({
      "proj-a": [
        spendRow({ tenant: "proj-a", id: "req-a2", atMs: 3000 }),
        spendRow({ tenant: "proj-a", id: "req-a-settled", atMs: 2500, status: "settled" }),
        spendRow({ tenant: "proj-a", id: "req-a1", atMs: 1000 }),
      ],
      "proj-b": [spendRow({ tenant: "proj-b", id: "req-b1", atMs: 2000, status: "failed" })],
    });

    const page = await repository.readSpendEventsAcrossTenants({
      tenantIds: ["proj-a", "proj-b"],
      statuses: ["confirmed", "failed"],
      limit: 2,
    });

    expect(statements.map((statement) => statement.tenantId)).toEqual(["proj-a", "proj-b"]);
    expect(statements.every((statement) => !statement.sql.includes("TenantId IN"))).toBe(true);
    expect(page.rows.map((row) => row.gatewayRequestId)).toEqual(["req-a2", "req-b1"]);
    expect(spendCursors.decodeSpendEventsCursor(page.nextCursor ?? "")).toEqual({
      eventTimestampMs: 2000,
      gatewayRequestId: "req-b1",
    });
  });

  /** @scenario "A short page ends the walk" */
  it("carries no cursor when the page is short", async () => {
    const { repository } = routedRepository({
      "proj-a": [spendRow({ tenant: "proj-a", id: "req-a1", atMs: 1000 })],
    });

    const page = await repository.readSpendEventsAcrossTenants({
      tenantIds: ["proj-a"],
      statuses: ["confirmed"],
      limit: 5,
    });

    expect(page.rows).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  /** @scenario "Every emitted-events statement names exactly one tenant" */
  /** @scenario "Gateway finds one spend event across tenants by request id and status" */
  it("looks an event up in each project with its own tenant-scoped statement", async () => {
    const { repository, statements } = routedRepository({
      "proj-b": [spendRow({ tenant: "proj-b", id: "req-b1", atMs: 2000 })],
    });

    const found = await repository.findSpendEventAcrossTenants({
      tenantIds: ["proj-a", "proj-b"],
      gatewayRequestId: "req-b1",
      statuses: ["confirmed", "failed"],
    });
    const settled = await repository.findSpendEventAcrossTenants({
      tenantIds: ["proj-a", "proj-b"],
      gatewayRequestId: "req-b1",
      statuses: ["settled"],
    });

    expect(found?.tenantId).toBe("proj-b");
    expect(settled).toBeNull();
    expect(statements.slice(0, 2).map((statement) => statement.params.tenantId)).toEqual([
      "proj-a",
      "proj-b",
    ]);
  });
});
