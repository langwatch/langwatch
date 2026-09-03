/**
 * @vitest-environment node
 * @integration
 *
 * The trace list surfaces cache/reasoning/context-size token attributes so
 * the list and drawer header can show context size next to tokens.
 * See specs/coding-agent/trace-fidelity.feature.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TraceListClickHouseRepository } from "../trace-list.repository";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support";

const clickHouseUrl = testClickHouseUrl();
const integration = describe.skipIf(clickHouseUrl === null);

let ch: ClickHouseClient;
let repo: TraceListClickHouseRepository;

const base = Date.now() - 60 * 60 * 1000;

function makeTraceSummaryRow(
  i: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: "unused",
    TraceId: `tr-${String(i).padStart(4, "0")}`,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(base + i),
    CreatedAt: new Date(base + i),
    UpdatedAt: new Date(base + i),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: `input-${i}`,
    ComputedOutput: `output-${i}`,
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: 100,
    TokensPerSecond: null,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: [],
    TotalCost: null,
    TokensEstimated: false,
    TotalPromptTokenCount: null,
    TotalCompletionTokenCount: null,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    TraceName: `trace-${i}`,
    RootSpanType: "",
    ContainsAi: false,
    ContainsPrompt: false,
    AnnotationIds: [],
    LastEventOccurredAt: new Date(base + i),
    TopicId: null,
    SubTopicId: null,
    ...overrides,
  };
}

async function insertRows(rows: ReturnType<typeof makeTraceSummaryRow>[]) {
  await ch.insert({
    table: "trace_summaries",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

integration("TraceListClickHouseRepository.findAll cache/reasoning/context attributes", () => {
  const cacheTenant = `test-cache-attrs-${nanoid()}`;

  beforeAll(async () => {
    if (!clickHouseUrl) return;
    ch = createTestClickHouseClient(clickHouseUrl);
    repo = TraceListClickHouseRepository.create(async () => ch);

    await insertRows([
      makeTraceSummaryRow(0, {
        TenantId: cacheTenant,
        TraceId: "cache-trace",
        Attributes: {
          "langwatch.origin": "coding_agent",
          "langwatch.reserved.cache_read_tokens": "31680",
          "langwatch.reserved.cache_creation_tokens": "6",
          "langwatch.reserved.reasoning_tokens": "100",
          "langwatch.reserved.context_size_tokens": "52878",
        },
      }),
    ]);
  }, 120_000);

  afterAll(async () => {
    if (!ch) return;
    await ch.exec({
      query: "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId: cacheTenant },
    });
  });

  describe("given a trace carries fold-summed cache + reasoning token attributes", () => {
    /** @scenario "Context size is shown in the trace list next to tokens" */
    it("surfaces the reserved cache/reasoning/context keys so the list and drawer header can show them", async () => {
      const page = await repo.findAll({
        tenantId: cacheTenant,
        timeRange: { from: base - 60_000, to: base + 60_000 },
        sort: { column: "OccurredAt", direction: "desc" },
        limit: 50,
        offset: 0,
      });

      const row = page.rows.find((r) => r.traceId === "cache-trace");
      expect(row).toBeDefined();
      expect(row?.attributes["langwatch.reserved.cache_read_tokens"]).toBe(
        "31680",
      );
      expect(row?.attributes["langwatch.reserved.cache_creation_tokens"]).toBe(
        "6",
      );
      expect(row?.attributes["langwatch.reserved.reasoning_tokens"]).toBe(
        "100",
      );
      expect(row?.attributes["langwatch.reserved.context_size_tokens"]).toBe(
        "52878",
      );
      // The pre-existing allow-listed keys still flow through.
      expect(row?.attributes["langwatch.origin"]).toBe("coding_agent");
    });
  });
});
