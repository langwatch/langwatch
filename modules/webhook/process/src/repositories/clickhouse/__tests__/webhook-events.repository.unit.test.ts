/** Spec: specs/webhooks/webhook-endpoints.feature */
import { describe, expect, it } from "vitest";

import { WebhookEventsClickHouseRepository } from "../clickhouse.webhook-events.repository.ts";
import {
  createWebhookClickHouseResolver,
  type WebhookRoutedClickHouse,
} from "../webhook-clickhouse.resolver.ts";

type Statement = { tenantId: string; sql: string; params: Record<string, unknown> };

function spendRow({ tenant, id, atMs }: { tenant: string; id: string; atMs: number }) {
  return {
    TenantId: tenant,
    GatewayRequestId: id,
    OrganizationId: "org-1",
    VirtualKeyId: "vk-1",
    Status: "confirmed",
    CostNanoUSD: 0,
    OccurredAtMs: atMs,
  };
}

/** Answers each tenant's rows, and refuses a statement the tenant guard would refuse. */
function routedClickHouse(rowsByTenant: Record<string, Record<string, unknown>[]>) {
  const statements: Statement[] = [];
  const clickhouse: WebhookRoutedClickHouse = {
    async query({ tenantId, sql, params = {} }) {
      statements.push({ tenantId, sql, params });
      if (!/TenantId = \{tenantId:String\}/.test(sql) || params.tenantId !== tenantId) {
        throw new Error(`statement is not scoped to its routed tenant ${tenantId}`);
      }
      return { rows: rowsByTenant[tenantId] ?? [] };
    },
  };
  return { clickhouse, statements };
}

describe("the emitted-events ClickHouse reads", () => {
  /** @scenario "Every emitted-events statement names exactly one tenant" */
  it("reads each project with its own tenant-scoped statement and merges newest first", async () => {
    const { clickhouse, statements } = routedClickHouse({
      "proj-a": [
        spendRow({ tenant: "proj-a", id: "req-a2", atMs: 3000 }),
        spendRow({ tenant: "proj-a", id: "req-a1", atMs: 1000 }),
      ],
      "proj-b": [spendRow({ tenant: "proj-b", id: "req-b1", atMs: 2000 })],
    });
    const repository = WebhookEventsClickHouseRepository.create(
      createWebhookClickHouseResolver(clickhouse),
    );

    const page = await repository.readEmittedEventsPage({
      tenantIds: ["proj-a", "proj-b"],
      limit: 2,
    });

    expect(statements.map((statement) => statement.tenantId)).toEqual(["proj-a", "proj-b"]);
    expect(statements.every((statement) => !statement.sql.includes("TenantId IN"))).toBe(true);
    expect(page.rows.map((row) => row.gatewayRequestId)).toEqual(["req-a2", "req-b1"]);
    expect(WebhookEventsClickHouseRepository.findCursor(page.nextCursor ?? "")).toEqual({
      occurredAtMs: 2000,
      gatewayRequestId: "req-b1",
    });
  });

  /** @scenario "Every emitted-events statement names exactly one tenant" */
  it("looks an event up in each project with its own tenant-scoped statement", async () => {
    const { clickhouse, statements } = routedClickHouse({
      "proj-b": [spendRow({ tenant: "proj-b", id: "req-b1", atMs: 2000 })],
    });
    const repository = WebhookEventsClickHouseRepository.create(
      createWebhookClickHouseResolver(clickhouse),
    );

    const found = await repository.findEmittedEventById({
      tenantIds: ["proj-a", "proj-b"],
      id: "req-b1:completed",
    });

    expect(found?.tenantId).toBe("proj-b");
    expect(statements.map((statement) => statement.params.tenantId)).toEqual(["proj-a", "proj-b"]);
  });
});
