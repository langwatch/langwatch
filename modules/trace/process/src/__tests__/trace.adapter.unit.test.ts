import { AuthorizedClickHouse } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it, vi } from "vitest";

import { TraceModule } from "#app/trace.app";
import { TraceQueryFieldValuesRepository } from "#features/query/repositories/query-field-values.repository";
import { TracePayloadReaderRepository } from "#repositories/trace-payload-reader.repository";
import { TraceSummaryReaderRepository } from "#repositories/trace-summary-reader.repository";

import type { TraceFullIo } from "../features/read/services/trace-read-full-io.service.ts";
// From the port that defines them: an in-package test does not need the
// package's public surface, and `index.ts` publishes what CONSUMERS import.
import type {
  TraceClickHouseClient,
  TraceClickHouseResolver,
} from "../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import { ClickHouseTraceSpanRepository } from "../repositories/clickhouse/trace-span.repository.ts";
import { aggregateProof, ownProof } from "./support/authorization-proofs.fixture.ts";
import { TestModelProviderService } from "./support/model-provider.service.fake.ts";
import { TestTraceQueryClassification } from "./support/query-classification.fake.ts";
import { traceReadPorts } from "./support/trace-read-ports.fake.ts";

class EmptyQueryFieldValues extends TraceQueryFieldValuesRepository {
  async findAll() {
    return { values: [] };
  }
}

class NullSummaryReaderRepository extends TraceSummaryReaderRepository {
  async findSummary(): Promise<null> {
    return null;
  }
}

class EmptyPayloads extends TracePayloadReaderRepository {
  async read(): Promise<string> {
    throw new Error("no offloaded payloads");
  }
}

class EmptyFullIo implements TraceFullIo {
  recompute() {
    return { input: null, output: null };
  }
}

/** ClickHouse answers `SpanAttributes['missing']` with "", so every attribute column is present. */
const ABSENT_ATTRIBUTE_COLUMNS = {
  ToolName: "",
  ResponseModel: "",
  Cost: "",
  InputTokens: "",
  OutputTokens: "",
  CacheReadTokens: "",
  CacheCreationTokens: "",
  CacheCreation1hTokens: "",
  InputChars: "",
  AudioSeconds: "",
  InputAudioTokens: "",
  OutputAudioTokens: "",
  CustomInputRate: "",
  CustomOutputRate: "",
  CustomCacheReadRate: "",
  CustomCacheCreationRate: "",
  CustomCacheCreation1hRate: "",
  LwSpanCost: "",
};

const summaryRows = (cost: string | number): unknown[] => [
  {
    ...ABSENT_ATTRIBUTE_COLUMNS,
    SpanId: "span_1",
    ParentSpanId: null,
    SpanName: "llm",
    SpanType: "llm",
    ToolName: "",
    Model: "model",
    Cost: cost,
    InputTokens: 2,
    OutputTokens: 2,
    CacheReadTokens: "",
    CacheCreationTokens: "",
    StartTimeMs: 10,
    DurationMs: 20,
    UpdatedAtMs: 30,
    StatusCode: 1,
  },
];

const authorization = ownProof({ projectId: "project_1" });

type FencedCall = { tenantId: string; sql: string; params: Record<string, unknown> };

/** The proof-checked reader over a scripted client; each statement is logged as it ran. */
function fencedClickHouse(
  calls: FencedCall[],
  rowsFor: (callIndex: number) => unknown[],
): AuthorizedClickHouse {
  const client = clickHouseQueryClientDouble({
    query: vi.fn(
      async ({
        sql,
        params,
        tenantId,
      }: {
        sql: string;
        params?: Record<string, unknown>;
        tenantId: string;
      }) => {
        calls.push({ tenantId, sql, params: params ?? {} });
        return { rows: rowsFor(calls.length) };
      },
    ),
  });
  return new AuthorizedClickHouse({ resolveClient: async () => client });
}

const refusingResolver: TraceClickHouseResolver = () =>
  Promise.reject(new Error("the tree reads go through the fence"));

/** The span-tree repository with every summary read behind the fence. */
function fencedTree(
  calls: FencedCall[],
  rowsFor: (callIndex: number) => unknown[],
): ClickHouseTraceSpanRepository {
  return ClickHouseTraceSpanRepository.create({
    resolveClient: refusingResolver,
    clickhouse: fencedClickHouse(calls, rowsFor),
  });
}

describe("TraceModule.composeTree", () => {
  it("constructs concrete repositories behind the public adapter", async () => {
    const calls: FencedCall[] = [];
    const service = TraceModule.composeTree({
      resolveClient: refusingResolver,
      repository: fencedTree(calls, () => summaryRows(0.2)),
      modelProviders: new TestModelProviderService(),
      queryFieldValues: new EmptyQueryFieldValues(),
      queryClassification: new TestTraceQueryClassification(),
      summaryReader: new NullSummaryReaderRepository(),
      payloads: new EmptyPayloads(),
      fullIo: new EmptyFullIo(),
      ...traceReadPorts(),
    });

    const page = await service.getSpanTreePage({
      authorization,
      projectId: "project_1",
      traceId: "trace_1",
      limit: 10,
      occurredAtMs: 100,
      canSeeCosts: true,
    });

    expect(page.nodes[0]).toMatchObject({
      spanId: "span_1",
      endTimeMs: 30,
      durationMs: 20,
    });
    expect(calls).toHaveLength(1);
    expect(calls.every((call) => call.tenantId === "project_1")).toBe(true);
    expect(calls.every((call) => Boolean(call.sql))).toBe(true);
  });

  /** @scenario "A span tree is read page by page with the live response shape" */
  it("preserves the full node wire shape while pricing a missing stored cost", async () => {
    const calls: FencedCall[] = [];
    const modelProviders = new TestModelProviderService(0.47);
    const service = TraceModule.composeTree({
      resolveClient: refusingResolver,
      repository: fencedTree(calls, () => summaryRows("")),
      modelProviders,
      queryFieldValues: new EmptyQueryFieldValues(),
      queryClassification: new TestTraceQueryClassification(),
      summaryReader: new NullSummaryReaderRepository(),
      payloads: new EmptyPayloads(),
      fullIo: new EmptyFullIo(),
      ...traceReadPorts(),
    });

    const page = await service.getSpanTreePage({
      authorization,
      projectId: "project_1",
      traceId: "trace_1",
      limit: 10,
      occurredAtMs: 100,
      canSeeCosts: true,
    });

    expect(page.nodes).toEqual([
      {
        spanId: "span_1",
        parentSpanId: null,
        name: "llm",
        type: "llm",
        startTimeMs: 10,
        endTimeMs: 30,
        durationMs: 20,
        status: "ok",
        model: "model",
        toolName: null,
        cost: 0.47,
        inputTokens: 2,
        outputTokens: 2,
        cacheReadTokens: null,
        cacheCreationTokens: null,
        updatedAtMs: 30,
      },
    ]);
    expect(modelProviders.costInputs).toEqual([
      expect.objectContaining({
        model: "model",
        promptTokens: 2,
        completionTokens: 2,
        attrs: expect.objectContaining({
          "gen_ai.request.model": "model",
        }),
      }),
    ]);
  });
});

describe("ClickHouseTraceSpanRepository evaluation reads", () => {
  it("preserves the fields Evaluation consumes from canonical stored spans", async () => {
    const calls: string[] = [];
    const repository = ClickHouseTraceSpanRepository.create({
      clickhouse: fencedClickHouse([], () => []),
      resolveClient: async (): Promise<TraceClickHouseClient> => ({
        query: async ({ query }: { query: string }) => {
          calls.push(query);
          const rows: unknown[] = [
            {
              SpanType: "rag",
              Model: "",
              Contexts: JSON.stringify([
                { content: "plain context" },
                { content: { title: "structured context" } },
              ]),
            },
            { SpanType: "", Model: "model-1", Contexts: "" },
          ];

          return { json: async () => rows };
        },
      }),
    });

    await expect(
      repository.findEvaluationSpans({
        tenantId: "project_1",
        traceId: "trace_1",
      }),
    ).resolves.toEqual([
      {
        type: "rag",
        model: null,
        ragContextTexts: ["plain context", JSON.stringify({ title: "structured context" })],
      },
      { type: "span", model: "model-1", ragContextTexts: [] },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("FROM stored_spans");
    expect(calls[0]).not.toContain("trace_analytics");
  });

  it("keeps legacy event metric mapping and newest-event ordering", async () => {
    const calls: string[] = [];
    const repository = ClickHouseTraceSpanRepository.create({
      clickhouse: fencedClickHouse([], () => []),
      resolveClient: async (): Promise<TraceClickHouseClient> => ({
        query: async ({ query }: { query: string }) => {
          calls.push(query);
          const rows: unknown[] = [
            {
              EventType: "thumbs_up_down",
              Attributes: {
                "event.metrics.vote": "1",
                note: "useful",
              },
            },
          ];

          return { json: async () => rows };
        },
      }),
    });

    await expect(
      repository.findEvaluationEvents({
        tenantId: "project_1",
        traceId: "trace_1",
      }),
    ).resolves.toEqual([
      {
        eventType: "thumbs_up_down",
        metrics: [{ key: "vote", value: 1 }],
        details: [{ key: "note", value: "useful" }],
      },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("Events.Timestamp");
    expect(calls[0]).toContain("ORDER BY event_timestamp DESC");
    expect(calls[0]).not.toContain("elasticsearch");
  });
});

describe("ClickHouseTraceSpanRepository page parity", () => {
  it("fences every tree statement by the aggregate's members, never a named tenant", async () => {
    const calls: FencedCall[] = [];
    const repository = fencedTree(calls, (index) => (index === 1 ? [{ occurredAtMs: 0 }] : []));
    const aggregate = aggregateProof({
      projectId: "aggregate_1",
      members: [
        { projectId: "member_1", from: 0 },
        { projectId: "member_2", from: 0 },
      ],
    });

    await repository.listSummaryPage({ authorization: aggregate, traceId: "trace_1", limit: 1 });
    await repository.findSummarySince({
      authorization: aggregate,
      traceId: "trace_1",
      sinceUpdatedAtMs: 1,
    });

    // The resolver probes (recent, then unbounded), one unhinted page, one delta.
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.sql).not.toContain("{tenantId:String}");
      expect(call.sql).not.toContain("{{tenant");
      const params = JSON.stringify(call.params);
      expect(params).toContain("member_1");
      expect(params).toContain("member_2");
    }
  });

  it("uses the live cursor without constraining latest-version election", async () => {
    const calls: FencedCall[] = [];
    const repository = fencedTree(calls, () => [
      {
        ...ABSENT_ATTRIBUTE_COLUMNS,
        SpanId: "span_2",
        ParentSpanId: null,
        SpanName: "child",
        SpanType: "",
        ToolName: "",
        Model: "request-model",
        ResponseModel: "response-model",
        Cost: "0.3",
        InputTokens: "4",
        OutputTokens: "5",
        CacheReadTokens: "",
        CacheCreationTokens: "",
        StartTimeMs: 20,
        DurationMs: 10,
        UpdatedAtMs: 31,
        StatusCode: 2,
      },
    ]);

    const page = await repository.listSummaryPage({
      authorization,
      traceId: "trace_1",
      limit: 1,
      cursor: { startTimeMs: 10, spanId: "span_1" },
    });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.tenantId).toBe("project_1");
    expect(call.params).toMatchObject({
      cursorStart: 10,
      cursorSpan: "span_1",
      limit: 2,
    });
    expect(call.sql).toContain(
      "(toUnixTimestamp64Milli(StartTime), SpanId) > ({cursorStart:Int64}, {cursorSpan:String})",
    );
    expect(call.sql).toContain("AND StartTime >= fromUnixTimestamp64Milli({cursorStart:Int64})");
    expect(call.sql).not.toContain("StartTime <=");
    const innerElection = call.sql.slice(
      call.sql.indexOf("SELECT TenantId, TraceId, SpanId, max(UpdatedAt)"),
    );
    expect(innerElection).not.toContain("cursorStart");
    expect(page.rows).toEqual([
      expect.objectContaining({
        spanId: "span_2",
        type: null,
        model: "request-model",
        cost: 0.3,
        endTimeMs: 30,
        status: "error",
      }),
    ]);
  });

  /** @scenario "A stale occurrence timestamp still reads the trace" */
  it("retries an empty first hinted page without the occurrence bound", async () => {
    const calls: FencedCall[] = [];
    const repository = fencedTree(calls, (index) =>
      index === 1
        ? []
        : [
            {
              ...ABSENT_ATTRIBUTE_COLUMNS,
              SpanId: "span_1",
              ParentSpanId: null,
              SpanName: "root",
              SpanType: "llm",
              ToolName: "tool",
              Model: "model",
              ResponseModel: "",
              Cost: "1",
              InputTokens: "",
              OutputTokens: "",
              CacheReadTokens: "",
              CacheCreationTokens: "",
              StartTimeMs: 10,
              DurationMs: 1,
              UpdatedAtMs: 12,
              StatusCode: 1,
            },
          ],
    );

    const page = await repository.listSummaryPage({
      authorization,
      traceId: "trace_1",
      limit: 1,
      occurredAtMs: 100,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain("fromUnixTimestamp64Milli({fromMs:Int64})");
    expect(calls[1]?.sql).not.toContain("fromUnixTimestamp64Milli({fromMs:Int64})");
    expect(page.rows).toHaveLength(1);
  });

  /** @scenario "A stale occurrence timestamp still reads the trace" */
  it("treats an empty cursor page as the end without an unbounded retry", async () => {
    const calls: FencedCall[] = [];
    const repository = fencedTree(calls, () => []);

    const page = await repository.listSummaryPage({
      authorization,
      traceId: "trace_1",
      limit: 1,
      cursor: { startTimeMs: 10, spanId: "span_1" },
      occurredAtMs: 100,
    });

    expect(page).toEqual({ rows: [], hasMore: false });
    expect(calls).toHaveLength(1);
  });

  /** @scenario "A live waterfall receives row-version updates" */
  it("uses the live row-version delta query without an occurrence window", async () => {
    const calls: FencedCall[] = [];
    const repository = fencedTree(calls, () => [
      {
        ...ABSENT_ATTRIBUTE_COLUMNS,
        SpanId: "span_1",
        ParentSpanId: null,
        SpanName: "root",
        SpanType: "llm",
        ToolName: "",
        Model: "model",
        ResponseModel: "",
        Cost: "",
        InputTokens: "2",
        OutputTokens: "3",
        CacheReadTokens: "",
        CacheCreationTokens: "",
        StartTimeMs: 10,
        DurationMs: 20,
        UpdatedAtMs: 30,
        StatusCode: 1,
      },
    ]);

    const rows = await repository.findSummarySince({
      authorization,
      traceId: "trace_1",
      sinceUpdatedAtMs: 29,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.tenantId).toBe("project_1");
    expect(calls[0]?.params).toMatchObject({ traceId: "trace_1", sinceUpdatedAtMs: 29 });
    expect(calls[0]?.sql).toContain(
      "UpdatedAt > fromUnixTimestamp64Milli({sinceUpdatedAtMs:Int64})",
    );
    expect(calls[0]?.sql).toContain("LIMIT 10000");
    expect(calls[0]?.sql).not.toContain("fromMs:Int64");
    expect(rows).toEqual([
      expect.objectContaining({
        spanId: "span_1",
        endTimeMs: 30,
        updatedAtMs: 30,
        cost: null,
      }),
    ]);
  });
});
