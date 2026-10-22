/**
 * The largest legal braided proof (ADR-183 §3), against production schema: the most distinct
 * conditions a reader may hold, each at its most comparisons and characters, read by every
 * statement that opens a trace and applied by ClickHouse. Spec: modules/authz/specs/braids.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  type Authorization,
  BRAID_CONDITION_COMPILER_VERSION,
  BRAID_CONDITION_MAX_LENGTH,
  BRAID_CONDITION_MAX_TERMS,
  BRAID_MAX_DISTINCT_CONDITIONS,
  type CompiledWhere,
  compiledWhereSchema,
} from "@langwatch/authorization";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { braidedProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceBraidedTotalsService } from "../../../features/read/services/trace-braided-totals.service.ts";
import { TraceSummaryService } from "../../../features/read/services/trace-summary-read.service.ts";
import { SpanStorageClickHouseRepository } from "../span-storage.repository.ts";
import { ClickHouseTraceBraidReadsRepository } from "../trace-braid-reads.repository.ts";
import { ClickHouseTraceSpanRepository } from "../trace-span.repository.ts";
import { TraceSummaryClickHouseRepository } from "../trace-summary.repository.ts";
import { authorizedClickHouseFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const run = nanoid();
const reader = `test-braid-largest-reader-${run}`;
const traceId = `trace-largest-${run}`;
const owners = Array.from(
  { length: BRAID_MAX_DISTINCT_CONDITIONS },
  (_, index) => `test-braid-largest-owner-${index}-${run}`,
);
const base = Date.now() - 60 * 60 * 1000;
const at = { traceId, occurredAtMs: base };

/** Three UTF-8 bytes per character: the most bytes a bound literal of legal length can carry. */
const WIDE = "語";

/** Condition `seed` at the bounds: the most comparisons, every literal character used. */
function largestCondition(seed: number): CompiledWhere {
  const width = Math.floor(BRAID_CONDITION_MAX_LENGTH / (2 * BRAID_CONDITION_MAX_TERMS));
  const spare = BRAID_CONDITION_MAX_LENGTH - width * 2 * BRAID_CONDITION_MAX_TERMS;
  const literal = (term: number, side: string, length: number) =>
    `${seed}-${term}-${side}-`.padEnd(length, WIDE);
  const last = BRAID_CONDITION_MAX_TERMS - 1;
  return compiledWhereSchema.parse({
    version: BRAID_CONDITION_COMPILER_VERSION,
    tree: {
      kind: "and",
      terms: Array.from({ length: BRAID_CONDITION_MAX_TERMS }, (_, term) => ({
        kind: "attributeEquals",
        on: "resource",
        key: literal(term, "k", width),
        value: literal(term, "v", term === last ? width + spare : width),
      })),
    },
  });
}

const conditions = owners.map((_, index) => largestCondition(index));

/** The resource attributes a condition's comparisons all hold. */
function matchingResource(condition: CompiledWhere): Record<string, string> {
  if (condition.tree.kind !== "and") throw new Error("a largest condition is a conjunction");
  return Object.fromEntries(
    condition.tree.terms.map((term) =>
      term.kind === "attributeEquals" ? [term.key, term.value] : [],
    ),
  );
}

let ch: ClickHouseClient;
let summaries: TraceSummaryService;
let spanTree: ClickHouseTraceSpanRepository;
let spanStorage: SpanStorageClickHouseRepository;
let totals: TraceBraidedTotalsService;

function summaryRow(tenantId: string) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(base),
    CreatedAt: new Date(base),
    UpdatedAt: new Date(base),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: "input",
    ComputedOutput: "output",
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    Models: [],
    TokensEstimated: false,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    TraceName: `name-of-${tenantId}`,
    RootSpanType: "",
    ContainsAi: false,
    ContainsPrompt: false,
    AnnotationIds: [],
    LastEventOccurredAt: new Date(base),
  };
}

function spanRow({
  tenantId,
  spanId,
  resource = {},
}: {
  tenantId: string;
  spanId: string;
  resource?: Record<string, string>;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: spanId,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(base + 10),
    EndTime: new Date(base + 60),
    DurationMs: 50,
    SpanName: spanId,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: resource,
    SpanAttributes: { "langwatch.user_id": "user-1" },
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "test",
    ScopeVersion: null,
    "Events.Timestamp": [new Date(base + 20)],
    "Events.Name": ["checkpoint"],
    "Events.Attributes": [{ step: spanId }],
    CreatedAt: new Date(base),
    UpdatedAt: new Date(base),
  };
}

const settings = { async_insert: 0, wait_for_async_insert: 0 } as const;

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  const clickhouse = authorizedClickHouseFor(ch);
  summaries = TraceSummaryService.create({
    repository: TraceSummaryClickHouseRepository.create({
      resolveClient: async () => ch,
      clickhouse,
    }),
  });
  spanTree = ClickHouseTraceSpanRepository.create({ clickhouse });
  spanStorage = SpanStorageClickHouseRepository.create({
    resolveClient: async () => {
      throw new Error("this test reads only");
    },
    clickhouse,
  });
  totals = TraceBraidedTotalsService.create({
    reads: ClickHouseTraceBraidReadsRepository.create({ clickhouse }),
    prices: null,
  });
  await ch.insert({
    table: "trace_summaries",
    values: [reader, ...owners].map(summaryRow),
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
  const lastTermMissed = (resource: Record<string, string>) => {
    const keys = Object.keys(resource);
    return { ...resource, [keys[keys.length - 1] ?? ""]: "missed" };
  };
  await ch.insert({
    table: "stored_spans",
    values: [
      spanRow({ tenantId: reader, spanId: "reader-root" }),
      ...owners.flatMap((owner, index) => {
        const resource = matchingResource(conditions[index] as CompiledWhere);
        return [
          spanRow({ tenantId: owner, spanId: `match-${index}`, resource }),
          spanRow({ tenantId: owner, spanId: `miss-${index}`, resource: lastTermMissed(resource) }),
        ];
      }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  for (const table of ["trace_summaries", "stored_spans"]) {
    await ch.exec({
      query: `ALTER TABLE ${table} DELETE WHERE TenantId IN {tenants:Array(String)}`,
      query_params: { tenants: [reader, ...owners] },
    });
  }
});

const expectedSpans = [
  `reader-root@${reader}`,
  ...owners.map((owner, index) => `match-${index}@${owner}`),
].toSorted();

type Named = { spanId?: string; span_id?: string; ownerProjectId?: string | null };
const named = (rows: Named[]) =>
  rows.map((row) => `${row.spanId ?? row.span_id}@${row.ownerProjectId ?? reader}`).toSorted();

/** Every statement the trace drawer sends when it opens a braided trace. */
const reads: Record<string, (authorization: Authorization) => Promise<string[]>> = {
  spanTree: async (authorization) =>
    named((await spanTree.listSummaryPage({ authorization, ...at, limit: 1_000 })).rows),
  spansPaginated: async (authorization) =>
    named(
      (
        await spanStorage.listSpansPaginated({
          authorization,
          reads: "spans",
          ...at,
          limit: 1_000,
          offset: 0,
        })
      ).spans,
    ),
  spansDelta: async (authorization) =>
    named(
      await spanStorage.findSpansSince({
        authorization,
        reads: "spans",
        ...at,
        sinceStartTimeMs: base - 60_000,
      }),
    ),
  spansFull: async (authorization) =>
    named(await spanStorage.findSpansByTraceId({ authorization, reads: "spans", ...at })),
  spansFullResolved: async (authorization) =>
    (await spanStorage.findNormalizedSpansByTraceId({ authorization, reads: "spans", ...at }))
      .map((span) => `${span.spanId}@${span.tenantId}`)
      .toSorted(),
  spanSummary: async (authorization) =>
    named(await spanStorage.findSpanSummaryByTraceId({ authorization, reads: "spans", ...at })),
  spanLangwatchSignals: async (authorization) =>
    named(
      await spanStorage.findLangwatchSignalsByTraceId({ authorization, reads: "spans", ...at }),
    ),
  resourceInfo: async (authorization) =>
    named(await spanStorage.findSpanResourcesByTraceId({ authorization, reads: "spans", ...at })),
  traceEvents: async (authorization) =>
    named(await spanStorage.findTraceEventsByTraceId({ authorization, reads: "spans", ...at })),
};

describe.skipIf(!clickHouseConfigured)("the largest legal braided proof", () => {
  const proof = () =>
    braidedProof({
      projectId: reader,
      braids: owners.map((owner, index) => ({
        owner,
        compiledWhere: conditions[index],
        from: base - 60_000 - index,
      })),
    });

  describe("when the reader opens a trace with the most distinct conditions at their largest", () => {
    describe.each(Object.entries(reads))("given the %s read", (_name, read) => {
      /** @scenario "A reader's distinct conditions fit in one statement" */
      it("is accepted by ClickHouse and applies every condition", async () => {
        const authorization = await summaries.getTraceAuthorization({
          authorization: proof(),
          traceId,
        });

        expect(await read(authorization)).toEqual(expectedSpans);
      });
    });

    /** @scenario "A reader's distinct conditions fit in one statement" */
    it("totals each owner's matching span in the header", async () => {
      const authorization = await summaries.getTraceAuthorization({
        authorization: proof(),
        traceId,
      });

      const header = await totals.ownerTotals({ authorization, ...at });

      expect(
        header.map(({ ownerProjectId, spanCount }) => `${ownerProjectId}:${spanCount}`).toSorted(),
      ).toEqual(owners.map((owner) => `${owner}:1`).toSorted());
    });
  });
});
