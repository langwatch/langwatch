/**
 * ClickHouse 26.8 reads an unquoted integer into DateTime64 as Unix seconds (ClickHouse #108091).
 * These serialise the inserted rows as the client does and read OccurredAt back.
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { GatewayBudgetClickHouseRepository } from "../clickhouse.gateway-budget.repository.ts";
import type { GatewayClickHouseClient } from "../clickhouse.gateway-session.store.ts";
import { ClickHouseGatewaySpendEventsRepository } from "../clickhouse.gateway-spend-events.repository.ts";

const OCCURRED_AT_MS = 1_792_472_024_396;
const OCCURRED_AT_ISO = "2026-10-20T04:53:44.396Z";

type Insert = Parameters<GatewayClickHouseClient["insert"]>[0];

function recordingClient() {
  const inserts: Insert[] = [];
  const client = async () => ({
    query: async () => ({ json: async () => [] }),
    insert: async (input: Insert) => {
      inserts.push(input);
    },
  });
  /** Each row as the client puts it on the wire: one JSON.stringify per row. */
  const sentOccurredAt = () =>
    inserts.flatMap((insert) =>
      (insert.values as unknown[]).map(
        (row) => JSON.parse(JSON.stringify(row)).OccurredAt as unknown,
      ),
    );
  return { client, sentOccurredAt };
}

describe("ledger writes send OccurredAt as a quoted instant", () => {
  describe("when the budget ledger records a debit", () => {
    /** @scenario "A budget ledger debit carries OccurredAt as an instant, not epoch milliseconds" */
    it("sends OccurredAt as an ISO string, not epoch milliseconds", async () => {
      const { client, sentOccurredAt } = recordingClient();
      const repository = GatewayBudgetClickHouseRepository.create(client as never);

      await repository.insertDebit([
        {
          tenantId: "project-a",
          budgetId: "budget-1",
          scope: "PROJECT",
          scopeId: "project-a",
          window: "MONTH",
          virtualKeyId: "vk-1",
          gatewayRequestId: "request-1",
          amountNanoUsd: 1_000,
          tokensInput: 1,
          tokensOutput: 1,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          model: "gpt-5-mini",
          status: "SUCCESS",
          occurredAt: Temporal.Instant.fromEpochMilliseconds(OCCURRED_AT_MS),
        },
      ]);

      expect(sentOccurredAt()).toEqual([OCCURRED_AT_ISO]);
    });
  });

  describe("when the budget ledger records pulled provider usage", () => {
    /** @scenario "A pulled-usage ledger row carries OccurredAt as an instant, not epoch milliseconds" */
    it("sends OccurredAt as an ISO string, not epoch milliseconds", async () => {
      const { client, sentOccurredAt } = recordingClient();
      const repository = GatewayBudgetClickHouseRepository.create(client as never);

      await repository.insertPulledUsageRows([
        {
          tenantId: "project-a",
          scopeId: "project-a",
          restatementKey: "provider-a:2026-10-20",
          amountNanoUsd: 1_000,
          tokensInput: 1,
          tokensOutput: 1,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          model: "gpt-5-mini",
          occurredAt: Temporal.Instant.fromEpochMilliseconds(OCCURRED_AT_MS),
          observedAt: Temporal.Instant.fromEpochMilliseconds(OCCURRED_AT_MS + 60_000),
        },
      ]);

      expect(sentOccurredAt()).toEqual([OCCURRED_AT_ISO]);
    });
  });

  describe("when the spend fold writes a request", () => {
    /** @scenario "A spend ledger row carries OccurredAt as an instant, not epoch milliseconds" */
    it("sends OccurredAt as an ISO string, not epoch milliseconds", async () => {
      const { client, sentOccurredAt } = recordingClient();
      const repository = ClickHouseGatewaySpendEventsRepository.create(client as never);

      await repository.upsertFromFold([
        {
          tenantId: "project-a",
          gatewayRequestId: "request-1",
          state: { occurredAtMs: OCCURRED_AT_MS, LastEventOccurredAt: OCCURRED_AT_MS } as never,
        },
      ]);

      expect(sentOccurredAt()).toEqual([OCCURRED_AT_ISO]);
    });
  });
});
