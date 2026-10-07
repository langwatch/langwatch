// Spec: modules/trace/specs/trace-cross-owner-reads.feature. Each read against the old query.
import type { ClickHouseClient } from "@clickhouse/client";
import {
  ClickHouseQueryClient,
  type QueryDriver,
  type QueryRequest,
} from "@langwatch/clickhouse-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseTraceAttributedRollupRepository } from "../clickhouse.trace-attributed-rollup.repository.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const ORIGIN = "test.origin.kind";
const ORIGIN_VALUE = "ingestion_source";
const USER = "test.user_id";
const SOURCE = "test.source_id";
const SOURCE_TYPE = "test.source_type";
const tenantId = `test-attrroll-${nanoid()}`;
const siblingTenantId = `test-attrroll-sibling-${nanoid()}`;
const emptyTenantId = `test-attrroll-empty-${nanoid()}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();
const currentStart = now - 7 * DAY_MS;
const previousStart = now - 14 * DAY_MS;
const matches = [{ key: ORIGIN, value: ORIGIN_VALUE }];
const clickHouseConfigured = testClickHouseConfigured();

let ch: ClickHouseClient;
let repository: ClickHouseTraceAttributedRollupRepository;
const requests: QueryRequest[] = [];

function queryClient(raw: ClickHouseClient): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute(request) {
      requests.push(request);
      const result = await raw.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
      });
      return { rows: await result.json() };
    },
    insert: () => Promise.reject(new Error("the attributed rollups never insert")),
    command: () => Promise.reject(new Error("the attributed rollups never command")),
  };
  return new ClickHouseQueryClient({ driver });
}

async function oracle<Row>(query: string, params: Record<string, unknown>): Promise<Row[]> {
  const result = await ch.query({ query, query_params: params, format: "JSONEachRow" });
  return result.json<Row>();
}

function row(args: {
  tenant?: string;
  traceId: string;
  attributes: Record<string, string>;
  atMs: number;
  cost: number | null;
  updatedMs?: number;
  models?: string[];
}) {
  const at = new Date(args.atMs);
  return {
    ProjectionId: `projn-${nanoid()}`,
    TenantId: args.tenant ?? tenantId,
    TraceId: args.traceId,
    Version: "v1",
    Attributes: args.attributes,
    OccurredAt: at,
    CreatedAt: new Date(args.atMs + 1_000),
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

const governed = (user: string, source: string) => ({
  [ORIGIN]: ORIGIN_VALUE,
  [SOURCE_TYPE]: "otel",
  ...(user ? { [USER]: user } : {}),
  ...(source ? { [SOURCE]: source } : {}),
});

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repository = ClickHouseTraceAttributedRollupRepository.create(queryClient(ch));
  const at = (days: number) => now - days * DAY_MS;
  await ch.insert({
    table: "trace_summaries",
    values: [
      row({
        traceId: "t1",
        attributes: governed("u1", "s1"),
        atMs: at(1),
        cost: 1.25,
        models: ["m1"],
      }),
      row({
        traceId: "t2",
        attributes: governed("u2", "s2"),
        atMs: at(2),
        cost: 0.5,
        models: ["m2"],
      }),
      row({ traceId: "t3", attributes: governed("u1", "s1"), atMs: at(3), cost: 0.1 }),
      row({
        traceId: "t3",
        attributes: governed("u1", "s1"),
        atMs: at(3),
        cost: 0.9,
        updatedMs: at(3) + 5_000,
      }),
      row({ traceId: "t4", attributes: governed("u3", "s1"), atMs: at(10), cost: 2 }),
      row({ traceId: "t5", attributes: { [USER]: "u1" }, atMs: at(1), cost: 7 }),
      row({ traceId: "t6", attributes: governed("", "s3"), atMs: at(4), cost: null, models: [] }),
      row({ traceId: "t7", attributes: governed("u2", "s2"), atMs: at(20), cost: 4 }),
      row({
        tenant: siblingTenantId,
        traceId: "b1",
        attributes: { [USER]: "u1" },
        atMs: at(1),
        cost: 3,
      }),
      row({ tenant: siblingTenantId, traceId: "b2", attributes: {}, atMs: at(2), cost: 1 }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  await ch.command({
    query:
      "DELETE FROM trace_summaries WHERE TenantId IN ({tenantId:String}, {siblingTenantId:String})",
    query_params: { tenantId, siblingTenantId },
  });
});

const dedup = (where: string) => `(ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
  SELECT TenantId, TraceId, max(UpdatedAt) FROM trace_summaries WHERE ${where} GROUP BY TenantId, TraceId)`;
const RANGE = `TenantId = {tenantId:String}
  AND OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
  AND OccurredAt < fromUnixTimestamp64Milli({windowEnd:UInt64})`;
const GOVERNED = `ts.TenantId = {tenantId:String}
  AND ts.OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
  AND ts.OccurredAt < fromUnixTimestamp64Milli({windowEnd:UInt64})
  AND ts.Attributes[{originKey:String}] = {originValue:String}`;
const base = {
  tenantId,
  originKey: ORIGIN,
  originValue: ORIGIN_VALUE,
  userKey: USER,
  sourceKey: SOURCE,
};

describe.skipIf(!clickHouseConfigured)("ClickHouseTraceAttributedRollupRepository", () => {
  /** @scenario "Attributed spend comparison totals the current and previous window" */
  it("answers the current and previous spend and distinct users as governance's summary did", async () => {
    const [old] = await oracle<{ thisSpend: number; prevSpend: number; thisUsers: string }>(
      `SELECT
        sumIf(coalesce(ts.TotalCost, 0), ts.OccurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64})) AS thisSpend,
        sumIf(coalesce(ts.TotalCost, 0), ts.OccurredAt < fromUnixTimestamp64Milli({thisStart:UInt64})) AS prevSpend,
        uniqExactIf(ts.Attributes[{userKey:String}], ts.OccurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64})
          AND ts.Attributes[{userKey:String}] != '') AS thisUsers
      FROM trace_summaries ts WHERE ${GOVERNED} AND ${dedup(RANGE)}`,
      { ...base, windowStart: previousStart, windowEnd: now, thisStart: currentStart },
    );
    const answer = await repository.getAttributedSpendComparison({
      tenantId,
      matches,
      actorKey: USER,
      previousStartMs: previousStart,
      currentStartMs: currentStart,
      endMs: now,
    });
    expect(answer).toEqual({
      currentSpendUsd: Number(old?.thisSpend),
      previousSpendUsd: Number(old?.prevSpend),
      currentActors: Number(old?.thisUsers),
    });
    expect(answer.currentSpendUsd).toBeCloseTo(1.25 + 0.5 + 0.9, 9);
    expect(answer.currentActors).toBe(2);
  });

  /** @scenario "Attributed spend by value is sorted and paged in the store" */
  it.each([
    ["spend", "desc", "sum(spendUsd) DESC"],
    ["requests", "asc", "count() ASC"],
    ["lastActivity", "desc", "max(occurredAt) DESC"],
  ] as const)(
    "pages spend per user sorted by %s %s as governance did",
    async (sortBy, sortDirection, order) => {
      const old = await oracle<{
        actor: string;
        spendUsdStr: string;
        requests: string;
        lastActivityMs: string;
        mostUsedTarget: string;
      }>(
        `SELECT actor, toString(sum(spendUsd)) AS spendUsdStr, toString(count()) AS requests,
        toString(toUnixTimestamp64Milli(max(occurredAt))) AS lastActivityMs, any(model) AS mostUsedTarget
      FROM (SELECT ts.Attributes[{userKey:String}] AS actor, coalesce(ts.TotalCost, 0) AS spendUsd,
          ts.OccurredAt AS occurredAt, arrayElement(ts.Models, 1) AS model
        FROM trace_summaries ts WHERE ${GOVERNED} AND ts.Attributes[{userKey:String}] != '' AND ${dedup(RANGE)})
      GROUP BY actor ORDER BY ${order} LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
        { ...base, windowStart: currentStart, windowEnd: now, limit: 5, offset: 0 },
      );
      const answer = await repository.findAttributedSpendByValue({
        tenantId,
        matches,
        valueKey: USER,
        window: { startMs: currentStart, endMs: now },
        sortBy,
        sortDirection,
        limit: 5,
        offset: 0,
      });
      expect(answer).toEqual(
        old.map((r) => ({
          value: r.actor,
          spentUsd: r.spendUsdStr,
          requests: Number(r.requests),
          lastOccurredAtMs: Number(r.lastActivityMs),
          firstModel: r.mostUsedTarget,
        })),
      );
      expect(answer.map((r) => r.value).toSorted()).toEqual(["u1", "u2"]);
    },
  );

  /** @scenario "Attributed spend comparison by value splits each value's windows" */
  it("splits each source's spend at the current window as governance's team read did", async () => {
    const old = await oracle<{
      sourceId: string;
      thisSpendStr: string;
      prevSpendStr: string;
      thisRequests: string;
      lastActivityMs: string;
    }>(
      `SELECT sourceId,
        toString(sumIf(spendUsd, occurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64}))) AS thisSpendStr,
        toString(sumIf(spendUsd, occurredAt < fromUnixTimestamp64Milli({thisStart:UInt64}))) AS prevSpendStr,
        toString(countIf(occurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64}))) AS thisRequests,
        toString(toUnixTimestamp64Milli(maxIf(occurredAt, occurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64})))) AS lastActivityMs
      FROM (SELECT ts.Attributes[{sourceKey:String}] AS sourceId, coalesce(ts.TotalCost, 0) AS spendUsd, ts.OccurredAt AS occurredAt
        FROM trace_summaries ts WHERE ${GOVERNED} AND ts.Attributes[{sourceKey:String}] != '' AND ${dedup(RANGE)})
      GROUP BY sourceId`,
      { ...base, windowStart: previousStart, windowEnd: now, thisStart: currentStart },
    );
    const answer = await repository.findAttributedSpendComparisonByValue({
      tenantId,
      matches,
      valueKey: SOURCE,
      previousStartMs: previousStart,
      currentStartMs: currentStart,
      endMs: now,
    });
    const bySource = (rows: { value: string }[]) =>
      rows.toSorted((a, b) => a.value.localeCompare(b.value));
    expect(bySource(answer)).toEqual(
      bySource(
        old.map((r) => ({
          value: r.sourceId,
          currentSpendUsd: r.thisSpendStr,
          previousSpendUsd: r.prevSpendStr,
          currentRequests: Number(r.thisRequests),
          lastCurrentOccurredAtMs: Number(r.lastActivityMs),
        })),
      ),
    );
    expect(answer.find((r) => r.value === "s1")?.previousSpendUsd).toBe("2");
  });

  /** @scenario "Spend by project and attribute reads one declared tenant set" */
  it("rolls spend per project and user over the declared tenant set as governance's department read did", async () => {
    const tenants = [tenantId, siblingTenantId];
    const set = "{tenant0:String}, {tenant1:String}";
    const old = await oracle<{
      projectId: string;
      actor: string;
      spendUsdStr: string;
      requests: string;
      lastActivityMs: string;
    }>(
      `SELECT ts.TenantId AS projectId, ts.Attributes[{userKey:String}] AS actor,
        toString(sum(coalesce(ts.TotalCost, 0))) AS spendUsdStr, toString(count()) AS requests,
        toString(toUnixTimestamp64Milli(max(ts.OccurredAt))) AS lastActivityMs
      FROM trace_summaries ts
      WHERE ts.TenantId IN (${set})
        AND ts.OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
        AND ts.OccurredAt < fromUnixTimestamp64Milli({windowEnd:UInt64})
        AND ${dedup(`TenantId IN (${set}) AND OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64}) AND OccurredAt < fromUnixTimestamp64Milli({windowEnd:UInt64})`)}
      GROUP BY projectId, actor`,
      {
        tenant0: tenantId,
        tenant1: siblingTenantId,
        userKey: USER,
        windowStart: currentStart,
        windowEnd: now,
      },
    );
    requests.length = 0;
    const answer = await repository.findSpendByProjectAndValue({
      tenantIds: tenants,
      valueKey: USER,
      window: { startMs: currentStart, endMs: now },
    });
    const key = (r: { projectId: string; value: string }) => `${r.projectId}/${r.value}`;
    const sorted = <T extends { projectId: string; value: string }>(rows: T[]) =>
      rows.toSorted((a, b) => key(a).localeCompare(key(b)));
    expect(sorted(answer)).toEqual(
      sorted(
        old.map((r) => ({
          projectId: r.projectId,
          value: r.actor,
          spentUsd: r.spendUsdStr,
          requests: Number(r.requests),
          lastOccurredAtMs: Number(r.lastActivityMs),
        })),
      ),
    );
    expect(requests[0]?.tenantIds).toEqual(tenants);
  });

  /** @scenario "Daily attributed spend groups by an attribute or by the first model" */
  it.each([
    ["user", { kind: "attribute", key: USER }, "ts.Attributes[{userKey:String}]"],
    ["first model", { kind: "firstModel" }, "arrayElement(ts.Models, 1)"],
  ] as const)(
    "buckets daily spend by %s as governance's over-time read did",
    async (_label, groupBy, groupExpr) => {
      const old = await oracle<{ bucketMs: string; groupKey: string | null; spendUsdStr: string }>(
        `SELECT toString(toUnixTimestamp(toStartOfDay(ts.OccurredAt)) * 1000) AS bucketMs, ${groupExpr} AS groupKey,
        toString(sum(coalesce(ts.TotalCost, 0))) AS spendUsdStr
      FROM trace_summaries ts WHERE ${GOVERNED} AND ${dedup(RANGE)}
      GROUP BY bucketMs, groupKey ORDER BY bucketMs ASC`,
        { ...base, windowStart: previousStart, windowEnd: now },
      );
      const answer = await repository.findDailyAttributedSpend({
        tenantId,
        matches,
        groupBy,
        window: { startMs: previousStart, endMs: now },
      });
      const order = (rows: { dayStartMs: number; value: string | null }[]) =>
        rows.toSorted(
          (a, b) => a.dayStartMs - b.dayStartMs || String(a.value).localeCompare(String(b.value)),
        );
      expect(order(answer)).toEqual(
        order(
          old.map((r) => ({
            dayStartMs: Number(r.bucketMs),
            value: r.groupKey,
            spentUsd: r.spendUsdStr,
          })),
        ),
      );
    },
  );

  /** @scenario "Attributed trace counts by value are limited to the asked values" */
  it("counts traces per asked source as governance's source health did", async () => {
    const since = now - 30 * DAY_MS;
    const old = await oracle<{ sourceId: string; c: string }>(
      `SELECT ts.Attributes[{sourceKey:String}] AS sourceId, toString(count()) AS c
      FROM trace_summaries ts
      WHERE ts.TenantId = {tenantId:String} AND ts.OccurredAt >= fromUnixTimestamp64Milli({since:UInt64})
        AND ts.Attributes[{originKey:String}] = {originValue:String}
        AND ts.Attributes[{sourceKey:String}] IN ({sourceIds:Array(String)})
        AND ${dedup("TenantId = {tenantId:String} AND OccurredAt >= fromUnixTimestamp64Milli({since:UInt64})")}
      GROUP BY sourceId`,
      { ...base, since, sourceIds: ["s1", "s2"] },
    );
    const answer = await repository.countAttributedTracesByValue({
      tenantId,
      matches,
      valueKey: SOURCE,
      values: ["s1", "s2"],
      sinceMs: since,
    });
    const order = (rows: { value: string; count: number }[]) =>
      rows.toSorted((a, b) => a.value.localeCompare(b.value));
    expect(order(answer)).toEqual(
      order(old.map((r) => ({ value: r.sourceId, count: Number(r.c) }))),
    );
    expect(order(answer)).toEqual([
      { value: "s1", count: 3 },
      { value: "s2", count: 2 },
    ]);
  });

  /** @scenario "Attributed traces before a cursor list the newest first" */
  it("lists one source's traces before the cursor as governance's event list did", async () => {
    const old = await oracle<{
      eventId: string;
      eventType: string;
      actor: string;
      target: string;
      costUsd: number;
      tokensInput: number;
      tokensOutput: number;
      occurredMs: string;
      createdMs: string;
    }>(
      `SELECT ts.TraceId AS eventId, ts.Attributes[{sourceTypeKey:String}] AS eventType, ts.Attributes[{userKey:String}] AS actor,
        arrayElement(ts.Models, 1) AS target, coalesce(ts.TotalCost, 0) AS costUsd,
        coalesce(ts.TotalPromptTokenCount, 0) AS tokensInput, coalesce(ts.TotalCompletionTokenCount, 0) AS tokensOutput,
        toString(toUnixTimestamp64Milli(ts.OccurredAt)) AS occurredMs, toString(toUnixTimestamp64Milli(ts.CreatedAt)) AS createdMs
      FROM trace_summaries ts
      WHERE ts.TenantId = {tenantId:String} AND ts.OccurredAt < fromUnixTimestamp64Milli({beforeMs:UInt64})
        AND ts.Attributes[{originKey:String}] = {originValue:String} AND ts.Attributes[{sourceKey:String}] = {sourceId:String}
        AND ${dedup("TenantId = {tenantId:String}")}
      ORDER BY ts.OccurredAt DESC, ts.TraceId DESC LIMIT {limit:UInt32}`,
      { ...base, sourceTypeKey: SOURCE_TYPE, sourceId: "s1", beforeMs: now - 2 * DAY_MS, limit: 2 },
    );
    const answer = await repository.findAttributedTracesBefore({
      tenantId,
      matches: [...matches, { key: SOURCE, value: "s1" }],
      attributeKeys: [SOURCE_TYPE, USER],
      beforeMs: now - 2 * DAY_MS,
      limit: 2,
    });
    expect(answer).toEqual(
      old.map((r) => ({
        traceId: r.eventId,
        attributes: { [SOURCE_TYPE]: r.eventType, [USER]: r.actor },
        firstModel: r.target,
        costUsd: Number(r.costUsd),
        promptTokens: Number(r.tokensInput),
        completionTokens: Number(r.tokensOutput),
        occurredAtMs: Number(r.occurredMs),
        createdAtMs: Number(r.createdMs),
      })),
    );
    expect(answer.map((r) => r.traceId)).toEqual(["t3", "t4"]);
    expect(answer[0]?.costUsd).toBe(0.9);
  });

  /** @scenario "Attributed trace recency counts each window and the last occurrence" */
  it("counts one source's traces per window and its newest occurrence as governance's health metrics did", async () => {
    const since = {
      since24h: now - DAY_MS - 60_000,
      since7d: now - 7 * DAY_MS,
      since30d: now - 30 * DAY_MS,
    };
    const [old] = await oracle<{ c24: string; c7: string; c30: string; lastMs: string | null }>(
      `SELECT countIf(ts.OccurredAt >= fromUnixTimestamp64Milli({since24h:UInt64})) AS c24,
        countIf(ts.OccurredAt >= fromUnixTimestamp64Milli({since7d:UInt64})) AS c7, count() AS c30,
        (SELECT toString(toUnixTimestamp64Milli(max(OccurredAt))) FROM trace_summaries
         WHERE TenantId = {tenantId:String} AND Attributes[{originKey:String}] = {originValue:String} AND Attributes[{sourceKey:String}] = {sourceId:String}) AS lastMs
      FROM trace_summaries ts
      WHERE ts.TenantId = {tenantId:String} AND ts.OccurredAt >= fromUnixTimestamp64Milli({since30d:UInt64})
        AND ts.Attributes[{originKey:String}] = {originValue:String} AND ts.Attributes[{sourceKey:String}] = {sourceId:String}
        AND ${dedup("TenantId = {tenantId:String} AND OccurredAt >= fromUnixTimestamp64Milli({since30d:UInt64})")}`,
      { ...base, ...since, sourceId: "s2" },
    );
    const answer = await repository.getAttributedTraceRecency({
      tenantId,
      matches: [...matches, { key: SOURCE, value: "s2" }],
      countSinceMs: [since.since24h, since.since7d, since.since30d],
    });
    expect(answer).toEqual({
      counts: [Number(old?.c24), Number(old?.c7), Number(old?.c30)],
      lastOccurredAtMs: old?.lastMs ? Number(old.lastMs) : 0,
    });
    expect(answer.counts).toEqual([0, 1, 2]);
  });

  /** @scenario "A project with no matching traces answers empty" */
  it("answers empty lists, zero totals and no last occurrence for a project without traces", async () => {
    const window = { startMs: previousStart, endMs: now };
    const empty = { tenantId: emptyTenantId, matches };
    await expect(
      repository.getAttributedSpendComparison({
        ...empty,
        actorKey: USER,
        previousStartMs: previousStart,
        currentStartMs: currentStart,
        endMs: now,
      }),
    ).resolves.toEqual({ currentSpendUsd: 0, previousSpendUsd: 0, currentActors: 0 });
    await expect(
      repository.findAttributedSpendByValue({
        ...empty,
        valueKey: USER,
        window,
        sortBy: "spend",
        sortDirection: "desc",
        limit: 5,
        offset: 0,
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.findAttributedSpendComparisonByValue({
        ...empty,
        valueKey: SOURCE,
        previousStartMs: previousStart,
        currentStartMs: currentStart,
        endMs: now,
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.findSpendByProjectAndValue({ tenantIds: [emptyTenantId], valueKey: USER, window }),
    ).resolves.toEqual([]);
    await expect(
      repository.findDailyAttributedSpend({ ...empty, groupBy: { kind: "firstModel" }, window }),
    ).resolves.toEqual([]);
    await expect(
      repository.countAttributedTracesByValue({
        ...empty,
        valueKey: SOURCE,
        values: ["s1"],
        sinceMs: previousStart,
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.findAttributedTracesBefore({
        ...empty,
        attributeKeys: [USER],
        beforeMs: now,
        limit: 5,
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.getAttributedTraceRecency({
        ...empty,
        countSinceMs: [previousStart, currentStart],
      }),
    ).resolves.toEqual({ counts: [0, 0], lastOccurredAtMs: 0 });
  });
});
