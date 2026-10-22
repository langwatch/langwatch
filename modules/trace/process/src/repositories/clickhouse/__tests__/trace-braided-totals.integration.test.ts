/**
 * The trace header's braided totals against production schema (ADR-183 §5): read through the
 * reader's braided fence, so spans the condition hides are never counted.
 * Spec: modules/trace/specs/braided-spans.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { CompiledWhere } from "@langwatch/authorization";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { braidedProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceBraidedTotalsService } from "../../../features/read/services/trace-braided-totals.service.ts";
import { braidedTraceSummaryOf } from "../../../rules/braided-trace-totals.rules.ts";
import { ClickHouseTraceBraidReadsRepository } from "../trace-braid-reads.repository.ts";
import { authorizedClickHouseFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const reader = `test-braided-totals-reader-${nanoid()}`;
const owner = `test-braided-totals-owner-${nanoid()}`;
const traceId = `trace-braided-totals-${nanoid()}`;
const base = Date.now() - 60 * 60 * 1000;
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};

let ch: ClickHouseClient;
let service: TraceBraidedTotalsService;

function spanRow(input: {
  tenantId: string;
  spanId: string;
  startOffsetMs: number;
  durationMs: number;
  attributes?: Record<string, string>;
  updatedOffsetMs?: number;
}) {
  const start = new Date(base + input.startOffsetMs);
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: input.tenantId,
    TraceId: traceId,
    SpanId: input.spanId,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: start,
    EndTime: new Date(start.getTime() + input.durationMs),
    DurationMs: input.durationMs,
    SpanName: input.spanId,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: input.attributes ?? {},
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "test",
    ScopeVersion: null,
    "Events.Timestamp": [] as Date[],
    "Events.Name": [] as string[],
    "Events.Attributes": [] as Record<string, string>[],
    "Links.TraceId": [] as string[],
    "Links.SpanId": [] as string[],
    "Links.Attributes": [] as Record<string, string>[],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    CreatedAt: start,
    UpdatedAt: new Date(start.getTime() + (input.updatedOffsetMs ?? 0)),
  };
}

const usage = (cost: string, input: string, output: string) => ({
  "gen_ai.usage.cost": cost,
  "gen_ai.usage.input_tokens": input,
  "gen_ai.usage.output_tokens": output,
});

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  service = TraceBraidedTotalsService.create({
    reads: ClickHouseTraceBraidReadsRepository.create({ clickhouse: authorizedClickHouseFor(ch) }),
    prices: { estimateCost: () => 0 },
  });
  const web = { orchestrator: "web" };
  await ch.insert({
    table: "stored_spans",
    values: [
      spanRow({ tenantId: reader, spanId: "root", startOffsetMs: 0, durationMs: 1_000 }),
      spanRow({
        tenantId: owner,
        spanId: "web-1",
        startOffsetMs: 200,
        durationMs: 300,
        attributes: { ...web, ...usage("0.25", "100", "40") },
      }),
      spanRow({
        tenantId: owner,
        spanId: "web-2",
        startOffsetMs: 900,
        durationMs: 600,
        attributes: { ...web, ...usage("0.5", "10", "4") },
      }),
      spanRow({
        tenantId: owner,
        spanId: "app-1",
        startOffsetMs: 300,
        durationMs: 5_000,
        attributes: { orchestrator: "app", ...usage("9", "9000", "9000") },
      }),
      spanRow({
        tenantId: owner,
        spanId: "web-then-app",
        startOffsetMs: 400,
        durationMs: 100,
        attributes: { ...web, ...usage("7", "700", "700") },
      }),
      spanRow({
        tenantId: owner,
        spanId: "web-then-app",
        startOffsetMs: 400,
        durationMs: 100,
        attributes: { orchestrator: "app", ...usage("7", "700", "700") },
        updatedOffsetMs: 1_000,
      }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  await ch.exec({
    query: "ALTER TABLE stored_spans DELETE WHERE TenantId IN ({reader:String}, {owner:String})",
    query_params: { reader, owner },
  });
});

describe.skipIf(!clickHouseConfigured)("the trace header's braided totals", () => {
  describe("given an orchestrator trace holding braided spans with their own cost and tokens", () => {
    /** @scenario "The trace header's totals include braided spans and say so" */
    it("adds only the spans the condition lets through, each at its latest version", async () => {
      const authorization = braidedProof({
        projectId: reader,
        braids: [{ owner, compiledWhere: WEB }],
      });

      const totals = await service.ownerTotals({ authorization, traceId, occurredAtMs: base });

      expect(totals).toEqual([
        {
          ownerProjectId: owner,
          spanCount: 2,
          startMs: base + 200,
          endMs: base + 1_500,
          cost: 0.75,
          inputTokens: 110,
          outputTokens: 44,
        },
      ]);
      const summary = braidedTraceSummaryOf({
        header: {
          timestamp: base,
          durationMs: 1_000,
          spanCount: 1,
          totalCost: 0.1,
          inputTokens: 5,
          outputTokens: 5,
        },
        owners: [{ projectId: owner, name: "Specialists", canOpen: false }],
        totals,
        canSeeCosts: true,
      });
      expect(summary).toMatchObject({ spanCount: 3, durationMs: 1_500, inputTokens: 115 });
      expect(summary.cost).toBeCloseTo(0.85);
    });
  });
});
