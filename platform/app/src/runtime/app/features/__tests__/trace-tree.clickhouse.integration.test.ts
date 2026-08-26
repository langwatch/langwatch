import type { ClickHouseClient } from "@clickhouse/client";
import type { SpanTreeCursor, TraceService } from "@langwatch/trace-contract";
import { TraceQueryFieldValuesPort } from "@langwatch/trace-server";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppTraceRuntime } from "~/runtime/app/features/trace";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { TestModelProviderService } from "~/server/modelProviders/__tests__/model-provider-services.test-support";

const tenantId = `test-trace-tree-${nanoid()}`;
const base = Date.now() - 60 * 60 * 1_000;

const exactTraceId = `trace-${nanoid()}`;
const tieTraceId = `trace-${nanoid()}`;
const longTraceId = `trace-${nanoid()}`;

let clickHouse: ClickHouseClient;
let traces: TraceService;

class EmptyQueryFieldValues extends TraceQueryFieldValuesPort {
  async list() {
    return { values: [] };
  }
}

function spanIdFor(index: number): string {
  return `span-${String(index).padStart(4, "0")}`;
}

function makeStoredSpan(
  traceId: string,
  spanId: string,
  startTime: Date,
  overrides: Record<string, unknown> = {},
) {
  return {
    ProjectionId: `projection-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: spanId,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: startTime,
    EndTime: new Date(startTime.getTime() + 50),
    DurationMs: 50,
    SpanName: "test-span",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: { idx: spanId },
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
    CreatedAt: startTime,
    UpdatedAt: startTime,
    ...overrides,
  };
}

async function insertRows(rows: ReturnType<typeof makeStoredSpan>[]): Promise<void> {
  await clickHouse.insert({
    table: "stored_spans",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

async function walkTrace(traceId: string, limit: number) {
  const pages = [];
  let cursor: SpanTreeCursor | undefined = void 0;

  for (;;) {
    const page = await traces.getSpanTreePage({
      projectId: tenantId,
      traceId,
      limit,
      cursor,
      occurredAtMs: base,
      canSeeCosts: true,
    });
    pages.push(page);

    if (page.nextCursor === null) {
      return pages;
    }

    cursor = page.nextCursor;
  }
}

beforeAll(async () => {
  const containers = await startTestContainers();
  clickHouse = containers.clickHouseClient;
  traces = AppTraceRuntime.create({
    resolveClient: async () => clickHouse,
    modelProviders: new TestModelProviderService(),
    queryFieldValues: new EmptyQueryFieldValues(),
  }).build();

  await insertRows(
    Array.from({ length: 40 }, (_, index) =>
      makeStoredSpan(exactTraceId, spanIdFor(index), new Date(base + index * 10)),
    ),
  );
  await insertRows([
    makeStoredSpan(exactTraceId, spanIdFor(25), new Date(base - 5_000), {
      SpanAttributes: { idx: spanIdFor(25), stale: "yes" },
    }),
  ]);
  await insertRows(
    ["tie-a", "tie-b", "tie-c", "tie-d"].map((spanId) =>
      makeStoredSpan(tieTraceId, spanId, new Date(base + 500)),
    ),
  );
  await insertRows([
    ...[0, 1, 2].map((index) =>
      makeStoredSpan(longTraceId, `early-${index}`, new Date(base + index)),
    ),
    ...[0, 1].map((index) =>
      makeStoredSpan(
        longTraceId,
        `late-${index}`,
        new Date(base + 3 * 24 * 60 * 60 * 1_000 + index),
      ),
    ),
  ]);
}, 120_000);

afterAll(async () => {
  if (clickHouse) {
    await clickHouse.exec({
      query: "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  }

  await stopTestContainers();
});

describe("Trace tree ClickHouse composition", () => {
  it("walks an exact page multiple without a duplicate or empty final fetch", async () => {
    const pages = await walkTrace(exactTraceId, 10);
    const nodes = pages.flatMap((page) => page.nodes);

    expect(nodes.map((node) => node.spanId)).toEqual(
      Array.from({ length: 40 }, (_, index) => spanIdFor(index)),
    );
    expect(nodes.filter((node) => node.spanId === spanIdFor(25))).toHaveLength(1);
    expect(pages).toHaveLength(4);
    expect(pages.every((page) => page.nodes.length === 10)).toBe(true);
    expect(pages.map((page) => page.nextCursor === null)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it("uses the span id to cross a same-millisecond page boundary", async () => {
    const pages = await walkTrace(tieTraceId, 2);

    expect(pages.map((page) => page.nodes.map((node) => node.spanId))).toEqual([
      ["tie-a", "tie-b"],
      ["tie-c", "tie-d"],
    ]);
  });

  it("reaches spans beyond the occurred-at hint window", async () => {
    const pages = await walkTrace(longTraceId, 2);

    expect(pages.flatMap((page) => page.nodes.map((node) => node.spanId))).toEqual([
      "early-0",
      "early-1",
      "early-2",
      "late-0",
      "late-1",
    ]);
  });
});
