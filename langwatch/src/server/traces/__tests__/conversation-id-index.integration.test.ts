/**
 * @vitest-environment node
 * @integration
 *
 * Verifies the bloom_filter skip-index on the trace_summaries conversation-id
 * map element (migration 00035):
 *  - the migration attaches idx_conversation_id to the table, and
 *  - the thread-lookup shapes (`Attributes['gen_ai.conversation.id'] = {id}`
 *    and `... IN (...)`, no time bound) still return the correct traces.
 *
 * The lookup carries no OccurredAt predicate and the id lives in the Attributes
 * map, so without a skip index it falls back to decoding Attributes for every
 * granule. The index lets ClickHouse skip granule blocks that cannot contain
 * the id; correctness is identical either way, which is what this test pins.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";

let ch: ClickHouseClient;
const tag = nanoid();

async function insertTrace(
  tenantId: string,
  traceId: string,
  conversationId: string | null,
) {
  await ch.insert({
    table: "trace_summaries",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: traceId,
        Version: "v1",
        Attributes:
          conversationId === null
            ? {}
            : { "gen_ai.conversation.id": conversationId },
        OccurredAt: new Date(),
        CreatedAt: new Date(),
        UpdatedAt: new Date(),
        ComputedIOSchemaVersion: "",
        ComputedInput: "in",
        ComputedOutput: "out",
        TimeToFirstTokenMs: 1,
        TimeToLastTokenMs: 1,
        TotalDurationMs: 1,
        TokensPerSecond: 1,
        SpanCount: 1,
        ContainsErrorStatus: 0,
        ContainsOKStatus: 1,
        ErrorMessage: null,
        Models: ["gpt-5-mini"],
        TotalCost: 0.01,
        TokensEstimated: false,
        TotalPromptTokenCount: 1,
        TotalCompletionTokenCount: 1,
        OutputFromRootSpan: 0,
        OutputSpanEndTimeMs: 0,
        BlockedByGuardrail: 0,
        TopicId: null,
        SubTopicId: null,
        HasAnnotation: null,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE trace_summaries DELETE WHERE startsWith(TraceId, {tag:String})`,
      query_params: { tag },
    });
  }
  await stopTestContainers();
});

describe("trace_summaries conversation-id skip-index (migration 00035)", () => {
  it("attaches a bloom_filter index on the conversation-id map element", async () => {
    const ddl = await (
      await ch.query({
        query: "SHOW CREATE TABLE trace_summaries",
        format: "TabSeparatedRaw",
      })
    ).text();
    expect(ddl).toMatch(/INDEX\s+idx_conversation_id\b/i);
    expect(ddl).toMatch(/idx_conversation_id[\s\S]*TYPE\s+bloom_filter/i);
  });

  describe("when resolving a single thread id", () => {
    it("returns only the traces in that conversation", async () => {
      const tenantId = `${tag}-tenant-a`;
      const thread = `${tag}-conv-1`;
      await insertTrace(tenantId, `${tag}-t1`, thread);
      await insertTrace(tenantId, `${tag}-t2`, thread);
      await insertTrace(tenantId, `${tag}-t3`, `${tag}-conv-2`);
      await insertTrace(tenantId, `${tag}-t4`, null);

      const rows = await (
        await ch.query({
          query: `
            SELECT DISTINCT TraceId
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              AND Attributes['gen_ai.conversation.id'] = {threadId:String}
          `,
          query_params: { tenantId, threadId: thread },
          format: "JSONEachRow",
        })
      ).json<{ TraceId: string }>();

      expect(rows.map((r) => r.TraceId).sort()).toEqual(
        [`${tag}-t1`, `${tag}-t2`].sort(),
      );
    });
  });

  describe("when resolving multiple thread ids", () => {
    it("returns the union of their conversations", async () => {
      const tenantId = `${tag}-tenant-b`;
      await insertTrace(tenantId, `${tag}-b1`, `${tag}-bc-1`);
      await insertTrace(tenantId, `${tag}-b2`, `${tag}-bc-2`);
      await insertTrace(tenantId, `${tag}-b3`, `${tag}-bc-3`);

      const rows = await (
        await ch.query({
          query: `
            SELECT DISTINCT TraceId
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              AND Attributes['gen_ai.conversation.id'] IN ({threadIds:Array(String)})
          `,
          query_params: {
            tenantId,
            threadIds: [`${tag}-bc-1`, `${tag}-bc-3`],
          },
          format: "JSONEachRow",
        })
      ).json<{ TraceId: string }>();

      expect(rows.map((r) => r.TraceId).sort()).toEqual(
        [`${tag}-b1`, `${tag}-b3`].sort(),
      );
    });
  });

  describe("when the conversation id does not exist", () => {
    it("returns nothing", async () => {
      const rows = await (
        await ch.query({
          query: `
            SELECT DISTINCT TraceId
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              AND Attributes['gen_ai.conversation.id'] = {threadId:String}
          `,
          query_params: {
            tenantId: `${tag}-tenant-a`,
            threadId: `${tag}-missing`,
          },
          format: "JSONEachRow",
        })
      ).json<{ TraceId: string }>();

      expect(rows).toHaveLength(0);
    });
  });
});
