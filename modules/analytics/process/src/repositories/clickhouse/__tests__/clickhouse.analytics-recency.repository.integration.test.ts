/**
 * The recency read against the shipped `trace_analytics` schema: a left-out conversation drops
 * only its own traces, and a trace with no conversation (a NULL `ConversationId`) is kept.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { ClickHouseAnalyticsRecencyRepository } from "../clickhouse.analytics-recency.repository.ts";

const enabled = Boolean(
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL,
);

const TENANT_ID = `recency-${crypto.randomUUID()}`;
const SINCE = Temporal.Instant.fromEpochMilliseconds(Date.now() - 60 * 60_000);
const NO_CONVERSATION_AT_MS = SINCE.epochMilliseconds + 60_000;
const OTHER_CONVERSATION_AT_MS = SINCE.epochMilliseconds + 120_000;
const RUN_CONVERSATION_AT_MS = SINCE.epochMilliseconds + 180_000;

function queryClientOver(client: ClickHouseClient): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute(request) {
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
      return { rows: await result.json() };
    },
    insert: () => Promise.reject(new Error("this suite never inserts")),
    command: () => Promise.reject(new Error("this suite never commands")),
  };
  return new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
}

function traceRow({
  traceId,
  conversationId,
  occurredAtMs,
}: {
  traceId: string;
  conversationId: string | null;
  occurredAtMs: number;
}) {
  return {
    TenantId: TENANT_ID,
    TraceId: traceId,
    Version: "2026-09-01",
    OccurredAt: new Date(occurredAtMs),
    UpdatedAt: new Date(occurredAtMs),
    ConversationId: conversationId,
    Origin: "application",
  };
}

describe.skipIf(!enabled)("ClickHouseAnalyticsRecencyRepository against ClickHouse", () => {
  let client: ClickHouseClient;
  let recency: ClickHouseAnalyticsRecencyRepository;

  const lastOccurredMs = async (excludeConversationIds: readonly string[]) => {
    const found = await recency.findLastOccurredAt({
      projectId: TENANT_ID,
      source: "trace",
      since: SINCE,
      excludeConversationIds,
    });
    return found.map((instant) => instant.epochMilliseconds);
  };

  beforeAll(async () => {
    ({ client } = await startMigratedClickHouse());
    recency = ClickHouseAnalyticsRecencyRepository.create(queryClientOver(client));
    await client.insert({
      table: "trace_analytics",
      values: [
        traceRow({
          traceId: "trace-no-conversation",
          conversationId: null,
          occurredAtMs: NO_CONVERSATION_AT_MS,
        }),
        traceRow({
          traceId: "trace-other-conversation",
          conversationId: "conversation-other",
          occurredAtMs: OTHER_CONVERSATION_AT_MS,
        }),
        traceRow({
          traceId: "trace-run-conversation",
          conversationId: "conversation-run",
          occurredAtMs: RUN_CONVERSATION_AT_MS,
        }),
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  });

  afterAll(async () => {
    await deleteMigratedTenantRows({ client, tenantId: TENANT_ID, tables: ["trace_analytics"] });
  });

  describe("when the newest trace is in a left-out conversation", () => {
    /** @scenario "A recency read leaving conversations out still finds the other traces" */
    it("answers the newer of the traces outside it", async () => {
      expect(await lastOccurredMs([])).toEqual([RUN_CONVERSATION_AT_MS]);
      expect(await lastOccurredMs(["conversation-run"])).toEqual([OTHER_CONVERSATION_AT_MS]);
    });

    /** @scenario "A recency read leaving conversations out still finds the other traces" */
    it("still finds the trace with no conversation when both conversations are left out", async () => {
      expect(await lastOccurredMs(["conversation-run", "conversation-other"])).toEqual([
        NO_CONVERSATION_AT_MS,
      ]);
    });
  });
});
