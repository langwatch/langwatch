// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** @vitest-environment node */
/** Spec: specs/webhooks/webhook-endpoints.feature */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { startTestClickHouseEndpoints } from "@langwatch/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WebhookEventsClickHouseRepository } from "../clickhouse.webhook-events.repository.ts";

const tenantId = `test-webhook-events-${Math.random().toString(36).slice(2, 10)}`;
const baseTime = Date.UTC(2026, 6, 20, 12, 0, 0);

/**
 * The `gateway_spend` columns this listing reads, with the shipped types
 * (migration 00067). The engine and sort key matter: the fold rewrites one
 * row per lifecycle transition and the listing reads FINAL.
 */
const CREATE_TABLE = `
  CREATE TABLE gateway_spend (
    TenantId String, GatewayRequestId String, OrganizationId String,
    VirtualKeyId String, PrincipalUserId String DEFAULT '',
    EndUserId String DEFAULT '', TraceId String DEFAULT '',
    Model String, ProviderKey String DEFAULT '',
    RequestType LowCardinality(String) DEFAULT '',
    Status LowCardinality(String), ErrorClass LowCardinality(String) DEFAULT '',
    HttpStatus UInt16 DEFAULT 0, NeedsReconciliation UInt8 DEFAULT 0,
    SettleReason LowCardinality(String) DEFAULT '',
    TokensInput UInt64 DEFAULT 0, TokensOutput UInt64 DEFAULT 0,
    TokensCacheRead UInt64 DEFAULT 0, TokensCacheWrite UInt64 DEFAULT 0,
    TokensReasoning UInt64 DEFAULT 0,
    CostNanoUSD Int64 DEFAULT 0, RateVersion LowCardinality(String) DEFAULT '',
    Labels Array(String) DEFAULT [], Metadata String DEFAULT '',
    PodId String DEFAULT '', PodSeq UInt64 DEFAULT 0,
    DurationMS UInt32 DEFAULT 0, OccurredAt DateTime64(3),
    Version LowCardinality(String) DEFAULT '',
    CreatedAt UInt64 DEFAULT 0, LastEventOccurredAt UInt64 DEFAULT 0,
    EventTimestamp UInt64
  ) ENGINE = ReplacingMergeTree(EventTimestamp)
  PARTITION BY toYYYYMM(OccurredAt)
  ORDER BY (TenantId, GatewayRequestId)
`;

function spendRow(input: {
  gatewayRequestId: string;
  occurredAtMs: number;
  status: string;
  needsReconciliation?: boolean;
  settleReason?: string;
}): Record<string, unknown> {
  return {
    TenantId: tenantId,
    GatewayRequestId: input.gatewayRequestId,
    OrganizationId: "org-1",
    VirtualKeyId: "vk-1",
    PrincipalUserId: "",
    EndUserId: "end-user-1",
    TraceId: "trace-1",
    Model: "openai/gpt-5",
    ProviderKey: "prov-1",
    RequestType: "chat",
    Status: input.status,
    ErrorClass: "",
    HttpStatus: 0,
    NeedsReconciliation: input.needsReconciliation ? 1 : 0,
    SettleReason: input.settleReason ?? "",
    TokensInput: input.status === "settled" ? 0 : 100,
    TokensOutput: input.status === "settled" ? 0 : 10,
    CostNanoUSD: input.status === "settled" ? 0 : 1_000_000,
    RateVersion: "catalog@2026-07-26",
    Labels: [],
    Metadata: "",
    PodId: "pod-1",
    PodSeq: 1,
    DurationMS: 500,
    OccurredAt: input.occurredAtMs,
    CreatedAt: input.occurredAtMs,
    LastEventOccurredAt: input.occurredAtMs,
    EventTimestamp: input.occurredAtMs,
  };
}

let client: ClickHouseClient;
let eventsRepo: WebhookEventsClickHouseRepository;

beforeAll(async () => {
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "webhook-events-repository",
    names: ["shared"],
  });
  client = createClient({ url: endpoint!.url });
  // The endpoint is reused across runs, so start from an empty table.
  await client.command({ query: "DROP TABLE IF EXISTS gateway_spend SYNC" });
  await client.command({ query: CREATE_TABLE });
  eventsRepo = WebhookEventsClickHouseRepository.create(async () => client);
}, 120_000);

afterAll(async () => {
  await client?.close();
});

describe("webhook emitted-events listing", () => {
  /** @scenario "The events listing serves settlements under their own type and hides in-flight rows" */
  it("serves settled rows as gateway.request.settled, filters by type, and never serves admitted rows", async () => {
    const settledId = `req-settled-${Math.random().toString(36).slice(2, 8)}`;
    const admittedId = `req-admitted-${Math.random().toString(36).slice(2, 8)}`;
    await client.insert({
      table: "gateway_spend",
      format: "JSONEachRow",
      values: [
        spendRow({
          gatewayRequestId: settledId,
          occurredAtMs: baseTime + 100,
          status: "settled",
          needsReconciliation: true,
          settleReason: "confirmation_deadline_expired",
        }),
        spendRow({
          gatewayRequestId: admittedId,
          occurredAtMs: baseTime + 200,
          status: "admitted",
        }),
      ],
    });

    const settledPage = await eventsRepo.readEmittedEventsPage({
      tenantIds: [tenantId],
      fromMs: baseTime - 1,
      toMs: baseTime + 500,
      limit: 10,
      types: ["gateway.request.settled"],
    });
    expect(settledPage.rows.map((r) => r.gatewayRequestId)).toEqual([settledId]);
    expect(settledPage.rows[0]!.settleReason).toBe("confirmation_deadline_expired");

    const allPage = await eventsRepo.readEmittedEventsPage({
      tenantIds: [tenantId],
      fromMs: baseTime - 1,
      toMs: baseTime + 500,
      limit: 10,
    });
    const served = allPage.rows.map((r) => r.gatewayRequestId);
    expect(served).toContain(settledId);
    expect(served).not.toContain(admittedId);

    const unknown = await eventsRepo.readEmittedEventsPage({
      tenantIds: [tenantId],
      fromMs: baseTime - 1,
      toMs: baseTime + 500,
      limit: 10,
      types: ["gateway.request.imagined"],
    });
    expect(unknown.rows).toEqual([]);
  });

  /** @scenario "The events listing pages the organization's emitted events" */
  it("pages envelope rows newest first with a continuation cursor", async () => {
    // Its own window, disjoint from the settled/admitted fixtures above,
    // so cross-test rows can never satisfy these assertions.
    const windowStart = baseTime + 100_000;
    const suffix = Math.random().toString(36).slice(2, 8);
    const ids = [1, 2, 3].map((i) => `req-page-${i}-${suffix}`);
    await client.insert({
      table: "gateway_spend",
      format: "JSONEachRow",
      values: ids.map((id, i) =>
        spendRow({
          gatewayRequestId: id,
          occurredAtMs: windowStart + i * 1000,
          status: "confirmed",
        }),
      ),
    });

    const first = await eventsRepo.readEmittedEventsPage({
      tenantIds: [tenantId],
      fromMs: windowStart - 1,
      toMs: windowStart + 60_000,
      limit: 2,
    });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    expect(first.rows[0]!.occurredAt.epochMilliseconds).toBeGreaterThanOrEqual(
      first.rows[1]!.occurredAt.epochMilliseconds,
    );

    const second = await eventsRepo.readEmittedEventsPage({
      tenantIds: [tenantId],
      fromMs: windowStart - 1,
      toMs: windowStart + 60_000,
      cursor: first.nextCursor,
      limit: 2,
    });
    const seen = [
      ...first.rows.map((r) => r.gatewayRequestId),
      ...second.rows.map((r) => r.gatewayRequestId),
    ];
    // Exact set: the disjoint window makes leakage a failure, not noise.
    expect(seen.sort()).toEqual([...ids].sort());
  });
});
