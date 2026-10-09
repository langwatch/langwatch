/**
 * @vitest-environment node
 * @integration
 * ADR-175: the trace list reads through the proof, on a migrated `trace_summaries`.
 * @see specs/governance/aggregate-project.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { aggregateProof, ownProof } from "@langwatch/authorization/testing";
import type { ResolvedInstantEvalRun, TraceListCursor } from "@langwatch/trace-contract";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import { traceQueryTranslation } from "../../../services/__tests__/fixtures/trace-query-services.fixtures.ts";
import { TraceListClickHouseRepository } from "../trace-list.repository.ts";
import { authorizedReadsOver } from "./support/authorized-reads.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const run = nanoid();
const AGGREGATE = `proof-aggregate-${run}`;
const MEMBER_A = `proof-member-a-${run}`;
const MEMBER_B = `proof-member-b-${run}`;
const OUTSIDER = `proof-outsider-${run}`;
const PLAIN = `proof-plain-${run}`;
/** A second aggregate whose two members hold one trace id each, the same id. */
const TWIN_AGGREGATE = `proof-twin-aggregate-${run}`;
const TWIN_A = `proof-twin-a-${run}`;
const TWIN_B = `proof-twin-b-${run}`;
const TWIN_TRACE_ID = `twin-${run}`;

/** An aggregate as wide as the ADR sizes it: one shared grant per member, few holding rows. */
const WIDE_AGGREGATE = `proof-wide-aggregate-${run}`;
const WIDE_MEMBERS = 2_000;
const wideMember = (index: number) => `proof-wide-member-${String(index).padStart(4, "0")}-${run}`;
const WIDE_OUTSIDER = `proof-wide-outsider-${run}`;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Taken once ClickHouse is up, not at import: a proof expires a fixed age after its `now`. */
let NOW: number;
let TODAY: number;
let YESTERDAY: number;
let B_WINDOW: { from: number; until: number };
/** The full read window every scenario lists over. */
let WINDOW: { from: number; to: number };
const PLAIN_TRACES = 40;

function takeClock(): void {
  NOW = Date.now();
  TODAY = NOW - 60 * 60 * 1000;
  YESTERDAY = TODAY - DAY_MS;
  B_WINDOW = { from: TODAY - 10 * 60 * 1000, until: TODAY + 10 * 60 * 1000 };
  WINDOW = { from: YESTERDAY - DAY_MS, to: NOW + DAY_MS };
}

let ch: ClickHouseClient;
let repo: TraceListClickHouseRepository;

function summaryRow({
  tenantId,
  traceId,
  occurredAt,
}: {
  tenantId: string;
  traceId: string;
  occurredAt: number;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(occurredAt),
    CreatedAt: new Date(occurredAt),
    UpdatedAt: new Date(occurredAt),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: `input-${traceId}`,
    ComputedOutput: `output-${traceId}`,
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
    TraceName: `name-of-${tenantId}`,
    RootSpanType: "",
    ContainsAi: false,
    ContainsPrompt: false,
    AnnotationIds: [],
    LastEventOccurredAt: new Date(occurredAt),
    TopicId: null,
    SubTopicId: null,
  };
}

async function insert(rows: ReturnType<typeof summaryRow>[]) {
  await ch.insert({
    table: "trace_summaries",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

const aggregateReadsAandB = () =>
  aggregateProof({
    projectId: AGGREGATE,
    members: [
      { projectId: MEMBER_A, from: 0 },
      { projectId: MEMBER_B, from: B_WINDOW.from, until: B_WINDOW.until },
    ],
    now: NOW,
  });

async function listTraceIds(authorization: ReturnType<typeof ownProof>): Promise<string[]> {
  const page = await repo.listAll({
    authorization,
    timeRange: WINDOW,
    sort: { column: "OccurredAt", direction: "desc" },
    limit: 500,
    offset: 0,
  });
  return page.rows.map((row) => row.traceId);
}

/** One span carrying `marker`, named after its tenant. */
async function insertMarkedSpan({
  tenantId,
  traceId,
  marker,
  startTimeMs,
}: {
  tenantId: string;
  traceId: string;
  marker: string;
  startTimeMs: number;
}) {
  await ch.insert({
    table: "stored_spans",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: traceId,
        SpanId: `span-${nanoid()}`,
        ParentSpanId: null,
        ParentTraceId: null,
        ParentIsRemote: null,
        Sampled: 1,
        StartTime: new Date(startTimeMs),
        EndTime: new Date(startTimeMs + 100),
        DurationMs: 100,
        SpanName: `span-of-${tenantId}`,
        SpanKind: 1,
        ServiceName: "t",
        ResourceAttributes: {},
        SpanAttributes: { marker },
        StatusCode: 1,
        StatusMessage: "",
        EventCount: 0,
        LinkCount: 0,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

const rowKey = (row: { tenantId?: string; traceId: string }) => `${row.tenantId}:${row.traceId}`;

/** Walk the list one row per page through the keyset cursor, a sentinel row past each page. */
async function walkOneRowPerPage(authorization: ReturnType<typeof ownProof>): Promise<string[]> {
  const seen: string[] = [];
  let cursor: TraceListCursor | undefined;
  for (let guard = 0; guard < 20; guard++) {
    const page = await repo.listAll({
      authorization,
      timeRange: WINDOW,
      sort: { column: "OccurredAt", direction: "desc" },
      limit: 2,
      cursor,
    });
    const row = page.rows[0];
    if (!row) break;
    seen.push(rowKey(row));
    if (page.rows.length < 2) break;
    // The OccurredAt sort reads the storage anchor column, so the cursor carries that value.
    cursor = {
      sortValue: row.storageAnchorMs ?? row.occurredAt,
      ...(row.tenantId === void 0 ? {} : { tenantId: row.tenantId }),
      traceId: row.traceId,
    };
  }
  return seen;
}

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  takeClock();
  repo = TraceListClickHouseRepository.create({ reads: authorizedReadsOver(ch) });

  await insert([
    summaryRow({ tenantId: AGGREGATE, traceId: "agg-1", occurredAt: TODAY }),
    summaryRow({ tenantId: MEMBER_A, traceId: "a-1", occurredAt: TODAY + 1 }),
    summaryRow({ tenantId: MEMBER_A, traceId: "a-yesterday", occurredAt: YESTERDAY }),
    summaryRow({ tenantId: MEMBER_B, traceId: "b-in", occurredAt: TODAY + 2 }),
    summaryRow({
      tenantId: MEMBER_B,
      traceId: "b-outside",
      occurredAt: B_WINDOW.until + 60 * 1000,
    }),
    summaryRow({ tenantId: OUTSIDER, traceId: "out-1", occurredAt: TODAY + 3 }),
    summaryRow({ tenantId: OUTSIDER, traceId: "out-2", occurredAt: TODAY + 4 }),
    // The twin members: one trace id, two tenants, identical sort values.
    summaryRow({ tenantId: TWIN_A, traceId: TWIN_TRACE_ID, occurredAt: TODAY }),
    summaryRow({ tenantId: TWIN_B, traceId: TWIN_TRACE_ID, occurredAt: TODAY }),
    summaryRow({ tenantId: TWIN_A, traceId: "twin-a-only", occurredAt: TODAY }),
    summaryRow({ tenantId: TWIN_B, traceId: "twin-b-only", occurredAt: TODAY }),
    // The wide aggregate: first member open-ended, second windowed, last open-ended, one outside.
    summaryRow({ tenantId: wideMember(0), traceId: "wide-first", occurredAt: YESTERDAY }),
    summaryRow({ tenantId: wideMember(1), traceId: "wide-windowed-in", occurredAt: TODAY }),
    summaryRow({
      tenantId: wideMember(1),
      traceId: "wide-windowed-out",
      occurredAt: B_WINDOW.until + 60 * 1000,
    }),
    summaryRow({
      tenantId: wideMember(WIDE_MEMBERS - 1),
      traceId: "wide-last",
      occurredAt: TODAY + 5,
    }),
    summaryRow({ tenantId: WIDE_OUTSIDER, traceId: "wide-outsider", occurredAt: TODAY + 6 }),
    ...Array.from({ length: PLAIN_TRACES }, (_, i) =>
      summaryRow({
        tenantId: PLAIN,
        traceId: `plain-${String(i).padStart(3, "0")}`,
        occurredAt: TODAY + i * 7,
      }),
    ),
  ]);
}, 120_000);

describe.skipIf(!clickHouseConfigured)("TraceListClickHouseRepository through the proof", () => {
  describe("given a proof with own grant on the aggregate and shared grants on members A and B", () => {
    describe("when the aggregate lists its traces", () => {
      /** @scenario "The client adds the tenant set from the proof" */
      it("returns the aggregate's rows and the members' rows inside their windows", async () => {
        const ids = await listTraceIds(aggregateReadsAandB());
        expect(ids).toEqual(expect.arrayContaining(["agg-1", "a-1", "a-yesterday", "b-in"]));
        expect(ids).not.toContain("b-outside");
      });
    });

    describe("when a fourth project has traces in the same window", () => {
      /** @scenario "A project outside the proof contributes nothing" */
      it("shows none of its rows in the list, the count, the trace ids or the facets", async () => {
        const authorization = aggregateReadsAandB();

        const ids = await listTraceIds(authorization);
        expect(ids).not.toContain("out-1");
        expect(ids).not.toContain("out-2");

        const count = await repo.findCount({
          authorization,
          timeRange: WINDOW,
          since: WINDOW.from,
        });
        expect(count).toBe(4);

        const traceIds = await repo.findTraceIds({ authorization, timeRange: WINDOW, limit: 100 });
        expect(traceIds.toSorted()).toEqual(["a-1", "a-yesterday", "agg-1", "b-in"]);

        const facets = await repo.findBatchedFacets({
          authorization,
          timeRange: WINDOW,
          table: "trace_summaries",
          timeColumn: "OccurredAt",
          categoricalSpecs: [{ key: "name", expression: "TraceName" }],
          rangeSpecs: [],
          topN: 50,
        });
        const names = facets.categoricals.name?.values.map((v) => v.value);
        expect(names).toEqual(
          expect.arrayContaining([
            `name-of-${AGGREGATE}`,
            `name-of-${MEMBER_A}`,
            `name-of-${MEMBER_B}`,
          ]),
        );
        expect(names).not.toContain(`name-of-${OUTSIDER}`);
      });
    });
  });

  describe("given a member grant whose from date is today", () => {
    describe("when the aggregate lists its traces", () => {
      /** @scenario "A trace written before the grant's from date is not shared" */
      it("shows today's member trace and not yesterday's", async () => {
        const ids = await listTraceIds(
          aggregateProof({
            projectId: AGGREGATE,
            members: [{ projectId: MEMBER_A, from: TODAY }],
            now: NOW,
          }),
        );
        expect(ids).toContain("a-1");
        expect(ids).not.toContain("a-yesterday");
      });
    });
  });

  describe("given two members holding the same trace id", () => {
    const twinProof = () =>
      aggregateProof({
        projectId: TWIN_AGGREGATE,
        members: [
          { projectId: TWIN_A, from: 0 },
          { projectId: TWIN_B, from: 0 },
        ],
        now: NOW,
      });

    describe("when the aggregate pages through them one row at a time", () => {
      /** @scenario "Paging an aggregate list hands out each member's row of a shared trace id exactly once" */
      it("hands out both rows exactly once across the pages", async () => {
        const seen = await walkOneRowPerPage(twinProof());

        expect(seen).toHaveLength(4);
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen).toEqual(
          expect.arrayContaining([
            `${TWIN_A}:${TWIN_TRACE_ID}`,
            `${TWIN_B}:${TWIN_TRACE_ID}`,
            `${TWIN_A}:twin-a-only`,
            `${TWIN_B}:twin-b-only`,
          ]),
        );
      });
    });

    describe("when the aggregate lists them on one page", () => {
      it("returns a row per tenant, each carrying its own tenant", async () => {
        const page = await repo.listAll({
          authorization: twinProof(),
          timeRange: WINDOW,
          sort: { column: "OccurredAt", direction: "desc" },
          limit: 10,
          offset: 0,
        });
        const twins = page.rows.filter((row) => row.traceId === TWIN_TRACE_ID);
        expect(twins.map(rowKey).toSorted()).toEqual([
          `${TWIN_A}:${TWIN_TRACE_ID}`,
          `${TWIN_B}:${TWIN_TRACE_ID}`,
        ]);
        expect(page.totalHits).toBe(4);
      });
    });

    describe("when a filter matches a span only member A's trace holds", () => {
      it("keeps member A's row and leaves member B's row of the same id out", async () => {
        await insertMarkedSpan({
          tenantId: TWIN_A,
          traceId: TWIN_TRACE_ID,
          marker: "only-in-a",
          startTimeMs: TODAY,
        });
        await insertMarkedSpan({
          tenantId: TWIN_B,
          traceId: TWIN_TRACE_ID,
          marker: "in-b",
          startTimeMs: TODAY,
        });
        const authorization = twinProof();
        const filterWhere =
          traceQueryTranslation.translateFilter({
            queryText: "span.attribute.marker:only-in-a",
            timeRange: WINDOW,
          }) ?? undefined;

        const page = await repo.listAll({
          authorization,
          timeRange: WINDOW,
          sort: { column: "OccurredAt", direction: "desc" },
          limit: 10,
          offset: 0,
          filterWhere,
        });
        expect(page.rows.map(rowKey)).toEqual([`${TWIN_A}:${TWIN_TRACE_ID}`]);

        const count = await repo.findCount({
          authorization,
          timeRange: WINDOW,
          since: WINDOW.from,
          filterWhere,
        });
        expect(count).toBe(1);

        const facets = await repo.findBatchedFacets({
          authorization,
          timeRange: WINDOW,
          table: "stored_spans",
          timeColumn: "StartTime",
          categoricalSpecs: [{ key: "span", expression: "SpanName" }],
          rangeSpecs: [],
          topN: 50,
          filterWhere,
        });
        expect(facets.categoricals.span?.values.map((v) => v.value)).toEqual([`span-of-${TWIN_A}`]);
      });
    });

    describe("when filters reach side tables no twin row has a match in", () => {
      it("runs each one across the members and matches by tenant and id", async () => {
        const evalRuns: ResolvedInstantEvalRun[] = [
          {
            question: "is it twinned",
            target: "traces",
            runId: `run-${run}`,
            writtenFrom: WINDOW.from,
            writtenUntil: WINDOW.to,
          },
          {
            question: "is the thread twinned",
            target: "threads",
            runId: `thread-run-${run}`,
            writtenFrom: WINDOW.from,
            writtenUntil: WINDOW.to,
          },
        ];
        const twinRows = async (queryText: string) => {
          const page = await repo.listAll({
            authorization: twinProof(),
            timeRange: WINDOW,
            sort: { column: "OccurredAt", direction: "desc" },
            limit: 10,
            offset: 0,
            filterWhere:
              traceQueryTranslation.translateFilter({ queryText, timeRange: WINDOW, evalRuns }) ??
              undefined,
          });
          return page.rows.length;
        };

        for (const field of [
          "scenarioVerdict:success",
          "evaluator:nobody",
          'eval:"is it twinned"',
          'eval.conversation:"is the thread twinned"',
        ]) {
          expect(await twinRows(field)).toBe(0);
          expect(await twinRows(`NOT ${field}`)).toBe(4);
        }
      });
    });

    describe("when a filter's trace selection is read", () => {
      it("answers a trace id once, even when two members hold it and two versions tie", async () => {
        const tieA = `proof-tie-a-${nanoid()}`;
        const tieB = `proof-tie-b-${nanoid()}`;
        const tied = summaryRow({ tenantId: tieA, traceId: "tie", occurredAt: TODAY });
        // Two inserts, so the tied versions land in two parts no merge has folded yet.
        await insert([tied, summaryRow({ tenantId: tieB, traceId: "tie", occurredAt: TODAY })]);
        await insert([{ ...tied, ProjectionId: `proj-${nanoid()}` }]);

        const ids = await repo.findTraceIds({
          authorization: aggregateProof({
            projectId: TWIN_AGGREGATE,
            members: [
              { projectId: tieA, from: 0 },
              { projectId: tieB, from: 0 },
            ],
            now: NOW,
          }),
          timeRange: WINDOW,
          limit: 10,
        });

        expect(ids).toEqual(["tie"]);
      });
    });
  });

  describe("given an aggregate with 2,000 members", () => {
    const wideProof = () =>
      aggregateProof({
        projectId: WIDE_AGGREGATE,
        members: Array.from({ length: WIDE_MEMBERS }, (_, index) =>
          index === 1
            ? { projectId: wideMember(index), ...B_WINDOW }
            : { projectId: wideMember(index), from: 0 },
        ),
        now: NOW,
      });

    describe("when it lists, counts and facets its traces", () => {
      it("answers every read with only the members' rows inside their windows", async () => {
        const authorization = wideProof();
        const expected = ["wide-first", "wide-last", "wide-windowed-in"];

        expect((await listTraceIds(authorization)).toSorted()).toEqual(expected);

        const count = await repo.findCount({
          authorization,
          timeRange: WINDOW,
          since: WINDOW.from,
        });
        expect(count).toBe(expected.length);

        const ids = await repo.findTraceIds({ authorization, timeRange: WINDOW, limit: 100 });
        expect(ids.toSorted()).toEqual(expected);

        const facets = await repo.findBatchedFacets({
          authorization,
          timeRange: WINDOW,
          table: "trace_summaries",
          timeColumn: "OccurredAt",
          categoricalSpecs: [{ key: "name", expression: "TraceName" }],
          rangeSpecs: [],
          topN: 50,
        });
        expect(facets.categoricals.name?.values.map((v) => v.value).toSorted()).toEqual(
          [
            `name-of-${wideMember(0)}`,
            `name-of-${wideMember(1)}`,
            `name-of-${wideMember(WIDE_MEMBERS - 1)}`,
          ].toSorted(),
        );
      });
    });
  });

  describe("given a plain project with no shared grants", () => {
    describe("when it lists its traces through an own-only proof", () => {
      /** @scenario "A plain project reads the same rows as before" */
      it("returns the same ids in the same order as a direct tenant query", async () => {
        const viaProof = await listTraceIds(ownProof({ projectId: PLAIN, now: NOW }));

        const direct = await ch.query({
          query: `
            SELECT TraceId
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              AND OccurredAt >= fromUnixTimestamp64Milli({from:Int64})
              AND OccurredAt <= fromUnixTimestamp64Milli({to:Int64})
            ORDER BY OccurredAt DESC, TraceId ASC
          `,
          query_params: { tenantId: PLAIN, from: WINDOW.from, to: WINDOW.to },
          format: "JSONEachRow",
        });
        const directIds = (await direct.json<{ TraceId: string }>()).map((row) => row.TraceId);

        expect(directIds).toHaveLength(PLAIN_TRACES);
        expect(viaProof).toEqual(directIds);
      });
    });
  });
});
