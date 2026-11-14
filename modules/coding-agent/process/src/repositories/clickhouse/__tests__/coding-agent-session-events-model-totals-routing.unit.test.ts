import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
/**
 * How the per-call fact table's cross-tenant read reaches ClickHouse.
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { CodingAgentSessionEventsClickHouseRepository } from "../clickhouse.coding-agent-session-event.repository.ts";

const FROM_MS = Date.parse("2026-07-01T00:00:00.000Z");

/**
 * The process's one client, stood in for. It records the tenant each statement
 * NAMED — what the real client routes by — beside the tenant list the statement
 * scoped itself to.
 */
function recordingClient(rows: Record<string, unknown>[]): {
  client: ClickHouseQueryClient;
  named: () => string[];
  scopedTo: () => string[][];
} {
  const named: string[] = [];
  const scopedTo: string[][] = [];
  const client = clickHouseQueryClientDouble({
    read: async (request: { statement: unknown }) => {
      const statement = request.statement as ReaderReadStatement;
      named.push(statement.routeTenantId);
      scopedTo.push(String(statement.settings.SQL_langwatch_tenant_ids).split(","));
      return { rows };
    },
  });
  return { client, named: () => named, scopedTo: () => scopedTo };
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
    SumInputTokens: "1",
    SumOutputTokens: "1",
    SumCacheReadTokens: "1",
    SumCacheCreationTokens: "1",
    SumCostUsd: costUsd,
  };
}

const sumTotals = (clickhouse: ClickHouseQueryClient) =>
  CodingAgentSessionEventsClickHouseRepository.create({
    clickhouse,
    defaultTraceRetentionDays: 30,
  }).sumTokensByModelPerSession({
    tenantIds: ["tenant-a", "tenant-b"],
    sessionIds: ["session-a", "session-b"],
    fromMs: FROM_MS,
  });

describe("CodingAgentSessionEventsClickHouseRepository per-model totals", () => {
  describe("given an organization's project tenants", () => {
    describe("when their sessions' per-model totals are read", () => {
      it("asks for all of them in one statement scoped to the whole list", async () => {
        const endpoint = recordingClient([]);

        await sumTotals(endpoint.client);

        expect(endpoint.scopedTo()).toEqual([["tenant-a", "tenant-b"]]);
      });

      it("names one of those tenants, so the client routes the statement to their server", async () => {
        const endpoint = recordingClient([]);

        await sumTotals(endpoint.client);

        expect(endpoint.named()).toEqual(["tenant-a"]);
      });

      it("adds up every tenant's totals from that one answer", async () => {
        const endpoint = recordingClient([
          modelTotals({ tenantId: "tenant-a", sessionId: "session-a", costUsd: 3 }),
          modelTotals({ tenantId: "tenant-b", sessionId: "session-b", costUsd: 4 }),
        ]);

        const totals = await sumTotals(endpoint.client);

        expect(totals.map((row) => row.sessionId)).toEqual(["session-a", "session-b"]);
        expect(totals.map((row) => row.costUsd)).toEqual([3, 4]);
      });
    });
  });
});
