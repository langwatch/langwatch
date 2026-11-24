/**
 * The span facets counted from span_analytics, the light twin, against stored_spans on the same
 * spans: the batched read must give the same values and counts from either table.
 * @see specs/traces-v2/facet-light-twin.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import type { TenantScopeTimeColumn } from "@langwatch/clickhouse-client";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { CLICKHOUSE_FACET_CATALOG } from "../../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { batchedFacetSource } from "../../../features/facet/rules/trace-facet-light-twin.rules.ts";
import type { ExpressionCategoricalDef } from "../../../features/facet/rules/trace-facet-registry.rules.ts";
import { TraceListClickHouseRepository } from "../trace-list.repository.ts";
import { authorizedClickHouseFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();
const TENANT = `span-facets-twin-${nanoid()}`;
const SPAN_FACET_KEYS = ["spanType", "spanName", "spanStatus"];
const base = Date.now() - 60 * 60 * 1000;
const timeRange = { from: base - 60_000, to: base + 10 * 60_000 };

/** Twelve spans: three types, two names, a mix of ok, error and unset statuses. */
const SPANS = Array.from({ length: 12 }, (_, index) => ({
  traceId: `trace-${index % 4}`,
  spanId: `span-${index}`,
  type: ["llm", "tool", "chain"][index % 3] as string,
  name: index % 2 === 0 ? "retrieve" : "answer",
  status: [1, 2, null][index % 3] as number | null,
  at: base + index * 1_000,
}));

let ch: ClickHouseClient;
let repo: TraceListClickHouseRepository;

function storedSpanRow(span: (typeof SPANS)[number]) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: TENANT,
    TraceId: span.traceId,
    SpanId: span.spanId,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(span.at),
    EndTime: new Date(span.at + 50),
    DurationMs: 50,
    SpanName: span.name,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: {
      "langwatch.span.type": span.type,
      "gen_ai.input.messages": "x".repeat(2_000),
    },
    StatusCode: span.status,
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
    CreatedAt: new Date(span.at),
    UpdatedAt: new Date(span.at),
  };
}

function spanAnalyticsRow(span: (typeof SPANS)[number]) {
  return {
    TenantId: TENANT,
    TraceId: span.traceId,
    SpanId: span.spanId,
    ParentSpanId: null,
    StartTime: new Date(span.at),
    EndTime: new Date(span.at + 50),
    DurationMs: 50,
    SpanName: span.name,
    SpanKind: 1,
    StatusCode: span.status,
    Cost: null,
    NonBilledCost: null,
    SpanType: span.type,
    ProjectedAt: new Date(span.at),
  };
}

const spanFacets = CLICKHOUSE_FACET_CATALOG.registry.filter(
  (def): def is ExpressionCategoricalDef =>
    SPAN_FACET_KEYS.includes(def.key) && def.kind === "categorical" && "expression" in def,
);

async function countsFrom(floor: { from: string | null; rebuilding: boolean }) {
  const source = batchedFacetSource({
    catalog: CLICKHOUSE_FACET_CATALOG,
    table: "stored_spans",
    categoricals: spanFacets,
    ranges: [],
    floor,
    fromMs: timeRange.from,
  });
  const batch = await repo.findBatchedFacets({
    authorization: ownProof({ projectId: TENANT }),
    timeRange,
    table: source.table,
    timeColumn: source.timeColumn as TenantScopeTimeColumn,
    categoricalSpecs: spanFacets.map((def) => ({
      key: def.key,
      expression: source.expressionOf(def),
    })),
    rangeSpecs: [],
    topN: 10,
  });
  return { table: source.table, categoricals: batch.categoricals };
}

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repo = TraceListClickHouseRepository.create({ clickhouse: authorizedClickHouseFor(ch) });
  const settings = { async_insert: 0, wait_for_async_insert: 0 } as const;
  await ch.insert({
    table: "stored_spans",
    values: SPANS.map(storedSpanRow),
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
  await ch.insert({
    table: "span_analytics",
    values: SPANS.map(spanAnalyticsRow),
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
}, 120_000);

describe.skipIf(!clickHouseConfigured)("given spans stored in both span tables", () => {
  describe("when the span facets are counted from each table", () => {
    /** @scenario "Span facets from span_analytics count what stored_spans counts" */
    it("gives the same values and counts", async () => {
      const heavy = await countsFrom({ from: null, rebuilding: true });
      const light = await countsFrom({ from: null, rebuilding: false });

      expect(heavy.table).toBe("stored_spans");
      expect(light.table).toBe("span_analytics");
      for (const key of SPAN_FACET_KEYS) {
        const sorted = (values: { value: string; count: number }[] = []) =>
          values.toSorted((a, b) => a.value.localeCompare(b.value));
        expect(sorted(light.categoricals[key]?.values), key).toEqual(
          sorted(heavy.categoricals[key]?.values),
        );
        expect(light.categoricals[key]?.values.length, key).toBeGreaterThan(1);
      }
      expect(light.categoricals.spanType?.values).toContainEqual({ value: "llm", count: 4 });
    });
  });
});
