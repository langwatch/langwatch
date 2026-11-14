/**
 * A trace's full-span reads are built under the reader's proof (ADR-202): one reader statement
 * over the proof's tenants with the tenant setting, the single-trace memory ceiling and the
 * stored_spans id bound. Spec: modules/trace/specs/trace-read-service.feature
 */
import type { CompiledWhere } from "@langwatch/authorization";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { braidedProof, ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { SpanStorageClickHouseRepository } from "../span-storage.repository.ts";

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

const PROJECT = "project-1";
const OWNER = "project-owner";
const SPAN = "span-1";
const at = { traceId: "trace-1", occurredAtMs: 1_700_000_000_000 };
const authorization = ownProof({ projectId: PROJECT });
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};

type Rows = Record<string, unknown>[];

/** A reader answering `rows` (or each request's), keeping each request; the raw client refuses. */
function reader(rows: Rows | ((request: ReadRequest) => Rows) = []) {
  const requests: ReadRequest[] = [];
  const refuse = () => Promise.reject(new Error("a built read never reaches the raw client"));
  const repository = SpanStorageClickHouseRepository.create({
    resolveClient: refuse,
    clickhouse: { as: () => ({ query: refuse }) } as never,
    reader: clickHouseQueryClientDouble({
      async read(request: ReadRequest) {
        requests.push(request);
        return { rows: typeof rows === "function" ? rows(request) : rows };
      },
    }),
  });
  return { repository, requests };
}

/** One project's stored version of span-1, as the full-span projection names its columns. */
const spanRow = (tenantId: string) => ({
  SpanId: SPAN,
  TraceId: at.traceId,
  TenantId: tenantId,
  ParentSpanId: null,
  ParentTraceId: null,
  ParentIsRemote: null,
  Sampled: true,
  StartTimeMs: at.occurredAtMs,
  EndTimeMs: at.occurredAtMs + 250,
  DurationMs: 250,
  SpanName: `span of ${tenantId}`,
  SpanKind: 1,
  ResourceAttributes: {},
  SpanAttributes: {},
  StatusCode: 1,
  StatusMessage: null,
  ScopeName: "scope",
  ScopeVersion: null,
  Cost: null,
  NonBilledCost: null,
});

const reads = {
  "full spans": (repository: SpanStorageClickHouseRepository) =>
    repository.findSpansByTraceId({ authorization, ...at }),
  "normalized spans": (repository: SpanStorageClickHouseRepository) =>
    repository.findNormalizedSpansByTraceId({ authorization, ...at }),
  "stored spans": (repository: SpanStorageClickHouseRepository) =>
    repository.findStoredSpansByTraceId({ authorization, ...at }),
};

const singleSpanReads = {
  "span by ids": (repository: SpanStorageClickHouseRepository) =>
    repository.findSpanByIds({ authorization, ...at, spanId: SPAN }),
  "normalized span by ids": (repository: SpanStorageClickHouseRepository) =>
    repository.findNormalizedSpanByIds({ authorization, ...at, spanId: SPAN }),
  "derivation span by id": (repository: SpanStorageClickHouseRepository) =>
    repository.findNormalizedSpanById({ authorization, ...at, spanId: SPAN }),
};

const lightReads = {
  "span resources": (repository: SpanStorageClickHouseRepository) =>
    repository.findSpanResourcesByTraceId({ authorization, ...at }),
  "span tree": (repository: SpanStorageClickHouseRepository) =>
    repository.findSpanSummaryByTraceId({ authorization, ...at }),
};

const eventReads = {
  "trace events": (repository: SpanStorageClickHouseRepository) =>
    repository.findTraceEventsByTraceId({ authorization, ...at }),
  events: (repository: SpanStorageClickHouseRepository) =>
    repository.findEventsByTraceId({ authorization, ...at }),
  "span events": (repository: SpanStorageClickHouseRepository) =>
    repository.findSpanEvents({ authorization, ...at, spanId: SPAN }),
};

/** A span-tree row as the light projection names its columns, every attribute absent. */
const summaryRow = (overrides: Record<string, string>) => ({
  ...Object.fromEntries(
    [
      "SpanName",
      "SpanType",
      "ToolName",
      "RequestId",
      "QuerySource",
      "ToolUseId",
      "Model",
      "ResponseModel",
      "UsageCost",
      "InputTokens",
      "OutputTokens",
      "CacheReadTokens",
      "CacheCreationTokens",
      "CacheCreation1hTokens",
      "InputChars",
      "AudioSeconds",
      "InputAudioTokens",
      "OutputAudioTokens",
      "InputImageTokens",
      "OutputImageTokens",
      "CustomInputRate",
      "CustomOutputRate",
      "CustomCacheReadRate",
      "CustomCacheCreationRate",
      "CustomCacheCreation1hRate",
      "LwSpanCost",
    ].map((key) => [key, ""]),
  ),
  SpanId: SPAN,
  ParentSpanId: null,
  DurationMs: 250,
  StatusCode: 1,
  StartTimeMs: at.occurredAtMs,
  UpdatedAtMs: at.occurredAtMs,
  ...overrides,
});

/** The fence every built read of a trace carries: the reader's own tenants and the setting. */
function expectReaderFence(request: ReadRequest | undefined, table = "stored_spans") {
  expect(request?.table).toBe(table);
  expect(request?.statement).toMatchObject({
    kind: "tenant",
    identity: "reader",
    tenantIds: [PROJECT],
    settings: { SQL_langwatch_tenant_ids: PROJECT },
  });
  expect(request?.statement.sql).toContain("TenantId IN ({tenantScope_own:Array(String)})");
}

describe("SpanStorageClickHouseRepository light and event reads", () => {
  describe.each(Object.entries(lightReads))("given the %s read", (_name, read) => {
    /** @scenario "A trace's light span reads and event reads are fenced by the reader's proof" */
    it("elects each span's latest light columns under the proof, in start order", async () => {
      const { repository, requests } = reader();

      await read(repository);

      expect(requests).toHaveLength(1);
      expectReaderFence(requests[0]);
      const sql = requests[0]?.statement.sql ?? "";
      expect(sql).toContain("max(UpdatedAt)");
      expect(sql).toMatch(/ORDER BY StartTimeMs ASC\s+LIMIT 10000/);
      expect(sql).not.toContain("Events.");
      expect(requests[0]?.idBound).toMatchObject({
        occurredAtHint: at.occurredAtMs,
        fallback: "unbounded",
      });
    });
  });

  describe.each(Object.entries(eventReads))("given the %s read", (_name, read) => {
    /** @scenario "A trace's light span reads and event reads are fenced by the reader's proof" */
    it("unrolls the events only outside the stored_spans read", async () => {
      const { repository, requests } = reader();

      await read(repository);

      expect(requests).toHaveLength(1);
      expectReaderFence(requests[0]);
      const [unroll = "", ...stored] = (requests[0]?.statement.sql ?? "").split(
        "FROM stored_spans",
      );
      expect(unroll).toContain("arrayJoin(SpanEvents)");
      expect(stored.join("")).not.toContain("arrayJoin");
      expect(requests[0]?.idBound).toMatchObject({
        occurredAtHint: at.occurredAtMs,
        fallback: "none",
      });
    });
  });

  describe("given the events read", () => {
    it("drops exception events by a bound value", async () => {
      const { repository, requests } = reader();

      await repository.findEventsByTraceId({ authorization, ...at });

      const sql = requests[0]?.statement.sql ?? "";
      expect(sql).toMatch(/tupleElement\(Event, 2\) != \{v\d+:String\}/);
      expect(sql).not.toContain("'exception'");
      expect(JSON.stringify(requests[0]?.statement)).toContain('"exception"');
    });
  });

  describe("given one span's events read without a braid", () => {
    it("unrolls the span's newest version, read eagerly", async () => {
      const { repository, requests } = reader();

      await repository.findSpanEvents({ authorization, ...at, spanId: SPAN });

      const sql = requests[0]?.statement.sql ?? "";
      expect(sql).toMatch(/SpanId = \{v\d+:String\} ORDER BY UpdatedAt DESC LIMIT 1/);
      expect(sql).not.toContain("max(UpdatedAt)");
      expect(sql).toContain("query_plan_optimize_lazy_materialization = '0'");
    });
  });

  describe("given a span tree row whose span reports a usage cost", () => {
    it("takes the reported cost from the renamed usage-cost column", async () => {
      const { repository } = reader([summaryRow({ UsageCost: "0.5" })]);

      const [span] = await repository.findSpanSummaryByTraceId({ authorization, ...at });

      expect(span?.cost).toBe(0.5);
    });
  });

  describe("given the live poll of the spans started since a time", () => {
    /** @scenario "A live span poll and the trace time lookup are read within the reader's proof" */
    it("bounds the read and its election by the since-time, not by the id index", async () => {
      const { repository, requests } = reader();

      await repository.findSpansSince({ authorization, ...at, sinceStartTimeMs: 5 });

      expect(requests).toHaveLength(1);
      expectReaderFence(requests[0]);
      const sql = requests[0]?.statement.sql ?? "";
      expect(sql.match(/StartTime > fromUnixTimestamp64Milli\(\{v\d+:Int64\}\)/g)).toHaveLength(2);
      expect(sql).toContain("max(UpdatedAt)");
      expect(sql).not.toContain("idBound");
      expect(requests[0]?.idBound).toBeUndefined();
    });
  });

  describe("given a trace read with no time while the index is not ready", () => {
    /** @scenario "A live span poll and the trace time lookup are read within the reader's proof" */
    it("looks the time up on the trace's summary, the recent window first", async () => {
      const { repository, requests } = reader();
      await repository.findSpansByTraceId({ authorization, traceId: at.traceId });

      await requests[0]?.idBound?.resolveHint?.();

      const [recent, whole] = requests.slice(1);
      expectReaderFence(recent, "trace_summaries");
      expectReaderFence(whole, "trace_summaries");
      expect(recent?.statement.sql).toContain("min(OccurredAt)");
      expect(recent?.statement.sql).toMatch(/OccurredAt >= fromUnixTimestamp64Milli/);
      expect(whole?.statement.sql).not.toContain("OccurredAt >=");
    });
  });
});

describe("SpanStorageClickHouseRepository built reads", () => {
  describe.each(Object.entries(reads))("given the %s read", (_name, read) => {
    describe("when the reader's proof covers its own project", () => {
      /** @scenario "Every full-span read of a trace is fenced by the reader's proof" */
      it("sends one reader statement over the proof's tenants with the tenant setting", async () => {
        const { repository, requests } = reader();

        await read(repository);

        expect(requests).toHaveLength(1);
        expect(requests[0]?.table).toBe("stored_spans");
        expect(requests[0]?.statement).toMatchObject({
          kind: "tenant",
          identity: "reader",
          tenantIds: [PROJECT],
          settings: { SQL_langwatch_tenant_ids: PROJECT },
        });
        const sql = requests[0]?.statement.sql ?? "";
        expect(sql).toContain("TenantId IN ({tenantScope_own:Array(String)})");
        expect(sql).toContain("max(UpdatedAt)");
        expect(sql).toMatch(/SETTINGS[^]*max_memory_usage/);
        expect(requests[0]?.idBound).toMatchObject({
          occurredAtHint: at.occurredAtMs,
          fallback: "unbounded",
        });
      });
    });
  });

  describe("given the full spans read of a braided reader that asks for spans", () => {
    /** @scenario "Every full-span read of a trace is fenced by the reader's proof" */
    it("reads the owner's spans under the braid's condition, never naming a tenant itself", async () => {
      const { repository, requests } = reader();
      const braided = braidedProof({
        projectId: PROJECT,
        braids: [{ owner: OWNER, compiledWhere: WEB }],
      });

      await repository.findSpansByTraceId({ authorization: braided, reads: "spans", ...at });

      expect(requests).toHaveLength(1);
      const sql = requests[0]?.statement.sql ?? "";
      expect(sql).toContain("{tenantScope_c0_ids:Array(String)}");
      expect(sql).not.toContain(OWNER);
      expect(sql).not.toContain("'web'");
    });
  });

  describe.each(Object.entries(singleSpanReads))("given the %s read", (_name, read) => {
    describe("when the reader's proof covers its own project", () => {
      /** @scenario "A single span is read within the reader's proof" */
      it("sends one reader statement for the span's newest version, read eagerly", async () => {
        const { repository, requests } = reader();

        await read(repository);

        expect(requests).toHaveLength(1);
        expect(requests[0]?.table).toBe("stored_spans");
        expect(requests[0]?.statement).toMatchObject({
          kind: "tenant",
          identity: "reader",
          tenantIds: [PROJECT],
          settings: { SQL_langwatch_tenant_ids: PROJECT },
        });
        const sql = requests[0]?.statement.sql ?? "";
        expect(sql).toContain("TenantId IN ({tenantScope_own:Array(String)})");
        expect(sql).toMatch(/SpanId = \{v\d+:String\}/);
        expect(sql).toMatch(/ORDER BY UpdatedAt DESC\s+LIMIT 1/);
        expect(sql).not.toContain("max(UpdatedAt)");
        expect(sql).toContain("query_plan_optimize_lazy_materialization = '0'");
        expect(requests[0]?.idBound).toMatchObject({ occurredAtHint: at.occurredAtMs });
      });
    });
  });

  describe("given the span read of a braided reader selecting the owner's span", () => {
    const braided = braidedProof({
      projectId: PROJECT,
      braids: [{ owner: OWNER, compiledWhere: WEB }],
    });

    /** @scenario "A single span is read within the reader's proof" */
    it("elects each project's latest version under the braid's condition and keeps the owner's", async () => {
      const { repository, requests } = reader([spanRow(PROJECT), spanRow(OWNER)]);

      const span = await repository.findNormalizedSpanByIds({
        authorization: braided,
        ...at,
        spanId: SPAN,
        ownerProjectId: OWNER,
      });

      expect(span?.tenantId).toBe(OWNER);
      const sql = requests[0]?.statement.sql ?? "";
      expect(sql).toContain("{tenantScope_c0_ids:Array(String)}");
      expect(sql).toContain("max(UpdatedAt)");
      expect(sql.match(/SpanId = \{v\d+:String\}/g)).toHaveLength(2);
      expect(sql).not.toContain(OWNER);
      expect(sql).not.toContain("'web'");
    });
  });
});

describe("SpanStorageClickHouseRepository page, rollup and model-sample reads", () => {
  const range = { Total: "1", FromMs: at.occurredAtMs, ToMs: at.occurredAtMs + 250 };
  /** The range read answers the range; the page read, no rows. */
  const rangeThenEmpty = (request: ReadRequest, tenants?: string[]) =>
    request.statement.sql.includes("countDistinct") ? [{ ...range, Tenants: tenants }] : [];

  describe("given a page of a trace's spans", () => {
    /** @scenario "A trace's span page is counted and read within the reader's proof" */
    it("counts within the id bound, then reads the page's latest spans within the range found", async () => {
      const { repository, requests } = reader((request) => rangeThenEmpty(request));

      const page = await repository.listSpansPaginated({
        authorization,
        ...at,
        limit: 10,
        offset: 20,
      });

      expect(page.total).toBe(1);
      expect(requests).toHaveLength(2);
      const [count, rows] = requests;
      expectReaderFence(count);
      expectReaderFence(rows);
      expect(count?.statement.sql).toContain("countDistinct(SpanId)");
      expect(count?.statement.sql).toMatch(/HAVING count\(\) > \{v\d+:UInt64\}$/);
      expect(count?.statement.sql).not.toContain("max(UpdatedAt)");
      expect(count?.idBound).toMatchObject({
        occurredAtHint: at.occurredAtMs,
        fallback: "unbounded",
      });
      const sql = rows?.statement.sql ?? "";
      expect(sql.match(/StartTime >= fromUnixTimestamp64Milli\(\{v\d+:Int64\}\)/g)).toHaveLength(2);
      expect(sql.match(/StartTime <= fromUnixTimestamp64Milli\(\{v\d+:Int64\}\)/g)).toHaveLength(2);
      expect(sql).toContain("max(UpdatedAt)");
      expect(sql).toMatch(/ORDER BY StartTime ASC LIMIT 10 OFFSET 20$/);
      expect(Object.values(rows?.statement.params ?? {})).toEqual(
        expect.arrayContaining([range.FromMs, range.ToMs]),
      );
      expect(rows?.idBound).toBeUndefined();
    });
  });

  describe("given a page of a trace's spans read through a braid", () => {
    /** @scenario "A trace's span page is counted and read within the reader's proof" */
    it("counts each project's latest spans under the braid's condition and names the projects", async () => {
      const braided = braidedProof({
        projectId: PROJECT,
        braids: [{ owner: OWNER, compiledWhere: WEB }],
      });
      const { repository, requests } = reader((request) => rangeThenEmpty(request, [PROJECT]));

      await repository.listSpansPaginated({
        authorization: braided,
        reads: "spans",
        ...at,
        limit: 10,
        offset: 0,
      });

      const sql = requests[0]?.statement.sql ?? "";
      expect(sql).toContain("countDistinct(tuple(TenantId, SpanId))");
      expect(sql).toContain("groupUniqArray(TenantId) AS Tenants");
      expect(sql).toContain("max(UpdatedAt)");
      expect(sql).toContain("{tenantScope_c0_ids:Array(String)}");
      expect(sql).not.toContain(OWNER);
      expect(sql).not.toContain("'web'");
    });
  });

  describe("given the event rollups of a page of traces", () => {
    /** @scenario "A page of traces' event rollups and a model's recent spans are read within the reader's proof" */
    it("elects over the page's traces, keeps spans whose latest version has events and unrolls after", async () => {
      const { repository, requests } = reader([
        {
          TenantId: PROJECT,
          TraceId: at.traceId,
          name: "click",
          nameCount: "2",
          firstTimestamp: "5",
          totalCount: "3",
          distinctCount: "2",
        },
      ]);

      const rollups = await repository.findTraceEventRollupsByTraceIds({
        authorization,
        traceIds: [at.traceId, "trace-2"],
        timeRange: { from: at.occurredAtMs, to: at.occurredAtMs },
      });

      expect(requests).toHaveLength(1);
      expectReaderFence(requests[0]);
      const sql = requests[0]?.statement.sql ?? "";
      const [unroll = "", ...stored] = sql.split("FROM stored_spans");
      expect(unroll).toContain("arrayJoin(SpanEvents)");
      expect(stored.join("")).not.toContain("arrayJoin");
      expect(sql.match(/TraceId IN \(\{v\d+:Array\(String\)\}\)/g)).toHaveLength(2);
      expect(sql.match(/notEmpty\(`Events\.Name`\)/g)).toHaveLength(1);
      expect(sql.split("max(UpdatedAt)")[1]).not.toContain("notEmpty");
      expect(sql).toContain("OVER (PARTITION BY TenantId, TraceId)");
      expect(sql).toMatch(/LIMIT \d+ BY TenantId, TraceId$/);
      expect(Object.values(rollups)).toEqual([
        {
          names: [{ name: "click", count: 2, firstTimestamp: 5 }],
          totalCount: 3,
          distinctCount: 2,
        },
      ]);
    });
  });

  describe("given recent spans sampled for a list of models", () => {
    /** @scenario "A page of traces' event rollups and a model's recent spans are read within the reader's proof" */
    it("reads the candidate traces from the summaries under the same fence", async () => {
      const { repository, requests } = reader();

      await repository.findRecentSpansByModels({
        authorization,
        models: ["gpt-4"],
        fromMs: at.occurredAtMs,
        perModelLimit: 3,
        limit: 30,
      });

      expect(requests).toHaveLength(1);
      expectReaderFence(requests[0]);
      const sql = requests[0]?.statement.sql ?? "";
      expect(sql).toMatch(
        /^WITH candidate_traces AS \(SELECT TraceId FROM trace_summaries WHERE \(TenantId IN \(\{tenantScope_own:Array\(String\)\}\)\)/,
      );
      expect(sql).toContain("TraceId IN candidate_traces");
      expect(sql).toMatch(/LIMIT 3 BY coalesce\([^]*\) LIMIT 30$/);
      expect(sql).not.toContain("gpt-4");
    });
  });
});
