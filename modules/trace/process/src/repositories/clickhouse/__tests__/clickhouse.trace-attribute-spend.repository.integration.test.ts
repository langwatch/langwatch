// Spec: specs/ai-gateway/budgets.feature. Gateway's per-key spend reads, over real ClickHouse.
import type { ClickHouseClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver } from "@langwatch/clickhouse-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseTraceAttributeSpendRepository } from "../clickhouse.trace-attribute-spend.repository.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const KEY = "langwatch.virtual_key_id";
const tenantId = `test-attrspend-${nanoid()}`;
const otherTenantId = `test-attrspend-other-${nanoid()}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const anchorMs = Date.now() - 40 * DAY_MS;
const recentMs = Date.now() - 60_000;
const clickHouseConfigured = testClickHouseConfigured();

let ch: ClickHouseClient;
let repository: ClickHouseTraceAttributeSpendRepository;

function queryClient(raw: ClickHouseClient): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute(request) {
      const result = await raw.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
      });
      return { rows: await result.json() };
    },
    insert: () => Promise.reject(new Error("the attribute spend reads never insert")),
    command: () => Promise.reject(new Error("the attribute spend reads never command")),
  };
  return new ClickHouseQueryClient({ driver });
}

function row(args: {
  tenant?: string;
  traceId: string;
  value: string;
  atMs: number;
  cost: number;
  updatedMs?: number;
  models?: string[];
}) {
  const at = new Date(args.atMs);
  return {
    ProjectionId: `projn-${nanoid()}`,
    TenantId: args.tenant ?? tenantId,
    TraceId: args.traceId,
    Version: "v1",
    Attributes: { [KEY]: args.value },
    OccurredAt: at,
    CreatedAt: at,
    UpdatedAt: new Date(args.updatedMs ?? args.atMs),
    ComputedIOSchemaVersion: "",
    ComputedInput: null,
    ComputedOutput: null,
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: 250,
    TokensPerSecond: null,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: args.models ?? ["gpt-5-mini"],
    TotalCost: args.cost,
    TokensEstimated: false,
    TotalPromptTokenCount: 100,
    TotalCompletionTokenCount: 50,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    TraceName: args.traceId,
    RootSpanType: "",
    ContainsAi: true,
    ContainsPrompt: false,
    AnnotationIds: [],
    LastEventOccurredAt: at,
    TopicId: null,
    SubTopicId: null,
  };
}

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repository = ClickHouseTraceAttributeSpendRepository.create(queryClient(ch));
  await ch.insert({
    table: "trace_summaries",
    values: [
      row({ traceId: "t-boundary", value: "vk-window", atMs: anchorMs, cost: 1.5 }),
      row({ traceId: "t-reprojected", value: "vk-reprojected", atMs: anchorMs, cost: 0.1 }),
      row({
        traceId: "t-reprojected",
        value: "vk-reprojected",
        atMs: anchorMs,
        cost: 0.9,
        updatedMs: anchorMs + 5_000,
      }),
      row({
        traceId: "t-recent",
        value: "vk-recent",
        atMs: recentMs,
        cost: 0.4,
        models: ["claude-sonnet-4"],
      }),
      row({
        tenant: otherTenantId,
        traceId: "t-other",
        value: "vk-recent",
        atMs: recentMs,
        cost: 8,
      }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  await ch.command({
    query:
      "DELETE FROM trace_summaries WHERE TenantId IN ({tenantId:String}, {otherTenantId:String})",
    query_params: { tenantId, otherTenantId },
  });
});

describe.skipIf(!clickHouseConfigured)(
  "ClickHouseTraceAttributeSpendRepository (integration)",
  () => {
    /** @scenario "The window start is inclusive and the window end is exclusive" */
    it("counts a trace on the window start and not on the window end", async () => {
      const read = (startMs: number, endMs: number) =>
        repository.findAttributeUsageBuckets({
          tenantId,
          attributeKey: KEY,
          values: ["vk-window"],
          window: { startMs, endMs },
        });

      expect((await read(anchorMs, anchorMs + 1000)).map((b) => b.requests)).toEqual([1]);
      expect(await read(anchorMs - 1000, anchorMs)).toEqual([]);
    });

    /** @scenario "A re-projected trace is counted once, at its latest cost" */
    it("counts a twice-projected trace once, at the later version's cost", async () => {
      const spend = await repository.findSpendByAttributeValue({
        tenantId,
        attributeKey: KEY,
        values: ["vk-reprojected"],
        window: { startMs: anchorMs, endMs: anchorMs + 60_000 },
      });

      expect(spend.map((s) => ({ ...s, spentUsd: Number(s.spentUsd) }))).toEqual([
        { value: "vk-reprojected", spentUsd: 0.9, requests: 1 },
      ]);
    });

    /** @scenario "Spend from minutes ago is inside the window the page asks for" */
    it("reads a request made moments ago from this tenant only", async () => {
      const traces = await repository.findAttributedTraces({
        tenantId,
        attributeKey: KEY,
        window: { startMs: Date.now() - 30 * DAY_MS, endMs: Date.now() },
        model: "claude-sonnet-4",
        limit: 20,
      });

      expect(traces.map((t) => [t.traceId, t.value, Number(t.costUsd)])).toEqual([
        ["t-recent", "vk-recent", 0.4],
      ]);
    });
  },
);
