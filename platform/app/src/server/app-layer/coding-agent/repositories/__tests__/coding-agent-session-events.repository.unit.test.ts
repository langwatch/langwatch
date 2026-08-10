/**
 * @vitest-environment node
 *
 * How the per-call fact table's cross-tenant read reaches ClickHouse.
 *
 * The write and read contracts against real ClickHouse live in the sibling
 * integration suite; what is pinned here is the routing, which no single
 * endpoint can observe.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it } from "vitest";

import { CodingAgentSessionEventsClickHouseRepository } from "../coding-agent-session-events.repository";

const FROM_MS = Date.parse("2026-07-01T00:00:00.000Z");

/**
 * A client that records the tenants each query was sent with and answers with
 * the rows it was given. One per endpoint, so a read that fans out is visible
 * as two recorded queries rather than one.
 */
function endpointClient(rows: Array<Record<string, unknown>>): {
  client: ClickHouseClient;
  sentTenantIds: () => string[][];
} {
  const sent: string[][] = [];
  const client = {
    query: async (args: { query_params: Record<string, unknown> }) => {
      sent.push(args.query_params.tenantIds as string[]);
      return { json: async () => rows };
    },
  } as unknown as ClickHouseClient;
  return { client, sentTenantIds: () => sent };
}

function modelTotals({
  tenantId,
  sessionId,
  costUsd,
}: {
  tenantId: string;
  sessionId: string;
  costUsd: number;
}): Record<string, unknown> {
  return {
    TenantId: tenantId,
    SessionId: sessionId,
    Model: "claude-fable-5",
    InputTokens: "1",
    OutputTokens: "1",
    CacheReadTokens: "1",
    CacheCreationTokens: "1",
    CostUsd: costUsd,
  };
}

describe("CodingAgentSessionEventsClickHouseRepository per-model totals routing", () => {
  describe("given tenants that resolve to two different endpoints", () => {
    describe("when their sessions' per-model totals are read", () => {
      it("queries each endpoint for its own tenants and adds both answers together", async () => {
        const first = endpointClient([
          modelTotals({
            tenantId: "tenant-a",
            sessionId: "session-a",
            costUsd: 3,
          }),
        ]);
        const second = endpointClient([
          modelTotals({
            tenantId: "tenant-b",
            sessionId: "session-b",
            costUsd: 4,
          }),
        ]);
        const repository = new CodingAgentSessionEventsClickHouseRepository(
          async (tenantId) =>
            tenantId === "tenant-a" ? first.client : second.client,
        );

        const totals = await repository.sumTokensByModelPerSession({
          tenantIds: ["tenant-a", "tenant-b"],
          sessionIds: ["session-a", "session-b"],
          fromMs: FROM_MS,
        });

        expect(first.sentTenantIds()).toEqual([["tenant-a"]]);
        expect(second.sentTenantIds()).toEqual([["tenant-b"]]);
        expect(totals.map((row) => row.sessionId)).toEqual([
          "session-a",
          "session-b",
        ]);
        expect(totals.map((row) => row.costUsd)).toEqual([3, 4]);
      });
    });
  });

  describe("given tenants that all resolve to one endpoint", () => {
    describe("when their sessions' per-model totals are read", () => {
      it("asks for all of them in a single query", async () => {
        const only = endpointClient([]);
        const repository = new CodingAgentSessionEventsClickHouseRepository(
          async () => only.client,
        );

        await repository.sumTokensByModelPerSession({
          tenantIds: ["tenant-a", "tenant-b"],
          sessionIds: ["session-a"],
          fromMs: FROM_MS,
        });

        expect(only.sentTenantIds()).toEqual([["tenant-a", "tenant-b"]]);
      });
    });
  });
});
