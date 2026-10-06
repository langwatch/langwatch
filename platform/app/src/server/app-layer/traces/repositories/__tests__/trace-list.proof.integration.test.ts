/**
 * ADR-144 block C, rung 3: the trace list repository reads through the
 * authorization proof. Against a real ClickHouse on the production
 * `trace_summaries` schema, with proofs sealed the way the authorizer seals
 * them, so the fence the client applies is the one a route would carry.
 *
 * Spec: specs/governance/aggregate-project.feature, section C.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthorizedClickHouse } from "~/server/app-layer/clients/clickhouse/authorized-reads";
import { aggregateProof, ownProof } from "~/test-utils/authorizationProofs";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { TraceListClickHouseRepository } from "../trace-list.clickhouse.repository";

const run = nanoid();
const AGGREGATE = `proof-aggregate-${run}`;
const MEMBER_A = `proof-member-a-${run}`;
const MEMBER_B = `proof-member-b-${run}`;
const OUTSIDER = `proof-outsider-${run}`;
const PLAIN = `proof-plain-${run}`;

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const TODAY = NOW - 60 * 60 * 1000;
const YESTERDAY = TODAY - DAY_MS;
const B_WINDOW = {
  from: TODAY - 10 * 60 * 1000,
  until: TODAY + 10 * 60 * 1000,
};

/** The full read window every scenario lists over. */
const WINDOW = { from: YESTERDAY - DAY_MS, to: NOW + DAY_MS };
const PLAIN_TRACES = 40;

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

async function listTraceIds(
  authorization: ReturnType<typeof ownProof>,
): Promise<string[]> {
  const page = await repo.findAll({
    authorization,
    timeRange: WINDOW,
    sort: { column: "OccurredAt", direction: "desc" },
    limit: 500,
    offset: 0,
  });
  return page.rows.map((row) => row.traceId);
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  repo = new TraceListClickHouseRepository(
    new AuthorizedClickHouse({ resolveClient: async () => ch }),
  );

  await insert([
    summaryRow({ tenantId: AGGREGATE, traceId: "agg-1", occurredAt: TODAY }),
    summaryRow({ tenantId: MEMBER_A, traceId: "a-1", occurredAt: TODAY + 1 }),
    summaryRow({
      tenantId: MEMBER_A,
      traceId: "a-yesterday",
      occurredAt: YESTERDAY,
    }),
    summaryRow({ tenantId: MEMBER_B, traceId: "b-in", occurredAt: TODAY + 2 }),
    summaryRow({
      tenantId: MEMBER_B,
      traceId: "b-outside",
      occurredAt: B_WINDOW.until + 60 * 1000,
    }),
    summaryRow({ tenantId: OUTSIDER, traceId: "out-1", occurredAt: TODAY + 3 }),
    summaryRow({ tenantId: OUTSIDER, traceId: "out-2", occurredAt: TODAY + 4 }),
    ...Array.from({ length: PLAIN_TRACES }, (_, i) =>
      summaryRow({
        tenantId: PLAIN,
        traceId: `plain-${String(i).padStart(3, "0")}`,
        occurredAt: TODAY + i * 7,
      }),
    ),
  ]);
}, 120_000);

afterAll(async () => {
  await stopTestContainers();
});

describe("TraceListClickHouseRepository through the proof", () => {
  describe("given a proof with own grant on the aggregate and shared grants on members A and B", () => {
    describe("when the aggregate lists its traces", () => {
      // @scenario "The client adds the tenant set from the proof"
      it("returns the aggregate's rows and the members' rows inside their windows", async () => {
        const ids = await listTraceIds(aggregateReadsAandB());
        expect(ids).toEqual(
          expect.arrayContaining(["agg-1", "a-1", "a-yesterday", "b-in"]),
        );
        expect(ids).not.toContain("b-outside");
      });
    });

    describe("when a fourth project has traces in the same window", () => {
      // @scenario "A project outside the proof contributes nothing"
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

        const traceIds = await repo.findTraceIds({
          authorization,
          timeRange: WINDOW,
          limit: 100,
        });
        expect(traceIds.sort()).toEqual([
          "a-1",
          "a-yesterday",
          "agg-1",
          "b-in",
        ]);

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
      // @scenario "A trace written before the grant's from date is not shared"
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

  describe("given a plain project with no shared grants", () => {
    describe("when it lists its traces through an own-only proof", () => {
      // @scenario "A plain project reads the same rows as before"
      it("returns the same ids in the same order as a direct tenant query", async () => {
        const viaProof = await listTraceIds(
          ownProof({ projectId: PLAIN, now: NOW }),
        );

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
        const directIds = (await direct.json<{ TraceId: string }>()).map(
          (row) => row.TraceId,
        );

        expect(directIds).toHaveLength(PLAIN_TRACES);
        expect(viaProof).toEqual(directIds);
      });
    });
  });
});
