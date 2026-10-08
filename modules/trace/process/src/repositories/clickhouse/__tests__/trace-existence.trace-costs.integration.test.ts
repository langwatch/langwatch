/** @see modules/experiment/specs/experiment-run-trace-cost.feature */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseTraceExistenceRepository } from "../trace-existence.repository.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const tenantId = `test-tcost-${nanoid()}`;
const settledTraceId = `trace-${nanoid()}`;
const lateTraceId = `trace-${nanoid()}`;
const base = Date.now() - 60 * 60 * 1000;
const window = { from: base - 60_000, to: base + 60_000 };

const clickHouseConfigured = testClickHouseConfigured();

let ch: ClickHouseClient;
let repo: ClickHouseTraceExistenceRepository;

function makeRow({
  traceId,
  occurredAtMs,
  updatedAtMs,
  totalCost,
}: {
  traceId: string;
  occurredAtMs: number;
  updatedAtMs: number;
  totalCost: number | null;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(occurredAtMs),
    CreatedAt: new Date(occurredAtMs),
    UpdatedAt: new Date(updatedAtMs),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: "input",
    ComputedOutput: "output",
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: 100,
    TokensPerSecond: null,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: [],
    TotalCost: totalCost,
    TokensEstimated: false,
    TotalPromptTokenCount: null,
    TotalCompletionTokenCount: null,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    TraceName: "trace",
    RootSpanType: "",
    ContainsAi: false,
    ContainsPrompt: false,
    AnnotationIds: [],
    LastEventOccurredAt: new Date(occurredAtMs),
    TopicId: null,
    SubTopicId: null,
  };
}

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repo = ClickHouseTraceExistenceRepository.create({ resolveClient: async () => ch });

  await ch.insert({
    table: "trace_summaries",
    values: [
      makeRow({ traceId: settledTraceId, occurredAtMs: base, updatedAtMs: base, totalCost: 0.1 }),
      makeRow({
        traceId: settledTraceId,
        occurredAtMs: base,
        updatedAtMs: base + 1_000,
        totalCost: 0.3,
      }),
      makeRow({
        traceId: lateTraceId,
        occurredAtMs: window.to + 60_000,
        updatedAtMs: window.to + 60_000,
        totalCost: 0.2,
      }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
    await ch.close();
  }
});

describe.skipIf(!clickHouseConfigured)(
  "ClickHouseTraceExistenceRepository.findTraceCosts (integration)",
  () => {
    describe("when one trace settled twice inside the window and another fell outside it", () => {
      /** @scenario "Trace answers the latest summary cost of the named traces inside the window" */
      it("answers the latest cost of the trace inside the window only", async () => {
        const costs = await repo.findTraceCosts({
          projectId: tenantId,
          traceIds: [settledTraceId, lateTraceId],
          occurredAt: window,
        });

        expect(costs).toEqual([{ traceId: settledTraceId, totalCost: 0.3 }]);
      });
    });
  },
);
