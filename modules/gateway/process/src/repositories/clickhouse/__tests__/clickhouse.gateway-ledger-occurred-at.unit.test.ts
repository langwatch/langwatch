/**
 * ClickHouse 26.8 reads an unquoted JSON integer into a DateTime64 column as
 * Unix seconds, not as ticks (ClickHouse #108091), so an epoch-millisecond
 * OccurredAt lands at 9999-12-31. The ledger writes therefore send a Date,
 * which the client serialises as a quoted ISO string that every version reads
 * the same way. These tests serialise the inserted rows the way the client
 * does and read OccurredAt back.
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

  describe("when the spend fold writes a request", () => {
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
