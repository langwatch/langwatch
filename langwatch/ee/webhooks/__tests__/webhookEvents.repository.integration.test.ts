// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GatewaySpendEventsRepository } from "~/server/gateway/spendEvents.clickhouse.repository";
import type { GatewaySpendState } from "~/server/event-sourcing/pipelines/gateway-spend-processing/projections/gatewaySpend.foldProjection";
import { WebhookEventsClickHouseRepository } from "../webhookEvents.clickhouse.repository";

const tenantId = `test-webhook-events-${nanoid(8)}`;
const baseTime = Date.UTC(2026, 6, 20, 12, 0, 0);

let client: ClickHouseClient;
let spendRepo: GatewaySpendEventsRepository;
let eventsRepo: WebhookEventsClickHouseRepository;

function state(occurredAtMs: number): GatewaySpendState {
  return {
    status: "confirmed",
    organizationId: "org-1",
    virtualKeyId: "vk-1",
    principalUserId: "",
    endUserId: "end-user-1",
    model: "openai/gpt-5",
    providerKey: "prov-1",
    traceId: "trace-1",
    requestType: "chat",
    labels: [],
    metadataJson: "",
    podId: "pod-1",
    podSeq: 1,
    usage: {
      input_tokens: 100,
      output_tokens: 10,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_tokens: 0,
    },
    rateVersion: "catalog@2026-07-26",
    costNanoUsd: 1_000_000,
    errorType: "",
    httpStatus: 0,
    needsReconciliation: false,
    settleReason: "",
    occurredAtMs,
    durationMs: 500,
    createdAt: occurredAtMs,
    updatedAt: occurredAtMs,
    LastEventOccurredAt: occurredAtMs,
  };
}

beforeAll(async () => {
  const containers = await startTestContainers();
  client = containers.clickHouseClient;
  const resolve = async () => client;
  spendRepo = new GatewaySpendEventsRepository(resolve);
  eventsRepo = new WebhookEventsClickHouseRepository(resolve);
}, 120_000);

afterAll(async () => {
  if (client) {
    await client.command({
      query: `ALTER TABLE gateway_spend DELETE WHERE TenantId = '${tenantId}'`,
    });
  }
  await stopTestContainers();
});

describe("webhook emitted-events listing", () => {
  /** @scenario The events listing pages the organization's emitted events */
  it("pages envelope rows newest first with a continuation cursor", async () => {
    const ids = [1, 2, 3].map((i) => `req-page-${i}-${nanoid(6)}`);
    await spendRepo.upsertFromFold(
      ids.map((id, i) => ({
        tenantId,
        gatewayRequestId: id,
        state: state(baseTime + i * 1000),
      })),
    );

    const first = await eventsRepo.readEmittedEventsPage({
      tenantIds: [tenantId],
      fromMs: baseTime - 1,
      toMs: baseTime + 60_000,
      limit: 2,
    });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    expect(first.rows[0]!.occurredAt.getTime()).toBeGreaterThanOrEqual(
      first.rows[1]!.occurredAt.getTime(),
    );

    const second = await eventsRepo.readEmittedEventsPage({
      tenantIds: [tenantId],
      fromMs: baseTime - 1,
      toMs: baseTime + 60_000,
      cursor: first.nextCursor,
      limit: 2,
    });
    const seen = new Set([
      ...first.rows.map((r) => r.gatewayRequestId),
      ...second.rows.map((r) => r.gatewayRequestId),
    ]);
    for (const id of ids) expect(seen.has(id)).toBe(true);
  });
});
