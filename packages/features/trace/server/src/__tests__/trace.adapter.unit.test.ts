import {
  TraceQueryFieldValuesPort,
  TracePayloadReaderPort,
  TraceFullIoPort,
  TraceSummaryReaderPort,
} from "../index";
// From the port that defines them: an in-package test does not need the
// package's public surface, and `index.ts` publishes what CONSUMERS import.
import type {
  TraceClickHouseClient,
  TraceClickHouseResolver,
} from "../ports/clickhouse.port";
import { ClickHouseTraceAdapter } from "../index";
import { ClickHouseTraceSpanRepository } from "../repositories/clickhouse/trace-span.repository";
import { describe, expect, it } from "vitest";
import { TestModelProviderService } from "../ports/__tests__/support/model-provider.service.fake";
import { TestTraceQueryClassification } from "../ports/__tests__/support/query-classification.fake";
import { traceReadPorts } from "../ports/__tests__/support/trace-read-ports.fake";

class EmptyQueryFieldValues extends TraceQueryFieldValuesPort {
  async list() {
    return { values: [] };
  }
}

class NullSummaryReader extends TraceSummaryReaderPort {
  async tryGetSummary(): Promise<null> {
    return null;
  }
}

class EmptyPayloads extends TracePayloadReaderPort {
  async tryRead(): Promise<null> {
    return null;
  }
}

class EmptyFullIo extends TraceFullIoPort {
  recompute() {
    return { input: null, output: null };
  }
}

const resolver =
  (
    calls: Array<{ tenantId: string; sql: string }>,
    cost: string | number = 0.2,
  ): TraceClickHouseResolver =>
  async (tenantId): Promise<TraceClickHouseClient> => ({
    query: async <_Row>({ query }: { query: string }) => {
      calls.push({ tenantId, sql: query });
      const rows: unknown[] = [
        {
          SpanId: "span_1",
          ParentSpanId: null,
          SpanName: "llm",
          SpanType: "llm",
          ToolName: null,
          Model: "model",
          Cost: cost,
          InputTokens: 2,
          OutputTokens: 2,
          CacheReadTokens: null,
          CacheCreationTokens: null,
          StartTimeMs: 10,
          DurationMs: 20,
          UpdatedAtMs: 30,
          StatusCode: 1,
        },
      ];
      return { json: async <T>() => rows as T[] };
    },
  });

describe("ClickHouseTraceAdapter", () => {
  it("constructs concrete repositories behind the public adapter", async () => {
    const calls: Array<{ tenantId: string; sql: string }> = [];
    const service = ClickHouseTraceAdapter.create({
      resolveClient: resolver(calls),
      modelProviders: new TestModelProviderService(),
      queryFieldValues: new EmptyQueryFieldValues(),
      queryClassification: new TestTraceQueryClassification(),
      summaryReader: new NullSummaryReader(),
      payloads: new EmptyPayloads(),
      fullIo: new EmptyFullIo(),
      ...traceReadPorts(),
    }).build();

    const page = await service.getSpanTreePage({
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

  it("preserves the full node wire shape while pricing a missing stored cost", async () => {
    const calls: Array<{ tenantId: string; sql: string }> = [];
    const modelProviders = new TestModelProviderService(0.47);
    const service = ClickHouseTraceAdapter.create({
      resolveClient: resolver(calls, ""),
      modelProviders,
      queryFieldValues: new EmptyQueryFieldValues(),
      queryClassification: new TestTraceQueryClassification(),
      summaryReader: new NullSummaryReader(),
      payloads: new EmptyPayloads(),
      fullIo: new EmptyFullIo(),
      ...traceReadPorts(),
    }).build();

    const page = await service.getSpanTreePage({
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
      resolve: async (): Promise<TraceClickHouseClient> => ({
        query: async <_Row>({ query }: { query: string }) => {
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

          return { json: async <T>() => rows as T[] };
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
      resolve: async (): Promise<TraceClickHouseClient> => ({
        query: async <_Row>({ query }: { query: string }) => {
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

          return { json: async <T>() => rows as T[] };
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
  it("rejects a blank tenant before issuing a ClickHouse read", async () => {
    let queryCount = 0;
    const repository = ClickHouseTraceSpanRepository.create({
      resolve: async (): Promise<TraceClickHouseClient> => ({
        query: async () => {
          queryCount += 1;
          return { json: async <T>() => [] as T[] };
        },
      }),
    });

    await expect(
      repository.findSummaryPage({ tenantId: " ", traceId: "trace_1", limit: 1 }),
    ).rejects.toThrow("TenantId must be a non-empty string");
    expect(queryCount).toBe(0);
  });

  it("uses the live cursor without constraining latest-version election", async () => {
    const calls: Array<{ sql: string; params?: Record<string, unknown> }> = [];
    const repository = ClickHouseTraceSpanRepository.create({
      resolve: async (): Promise<TraceClickHouseClient> => ({
        query: async <_Row>(input: Parameters<TraceClickHouseClient["query"]>[0]) => {
          calls.push({ sql: input.query, params: input.query_params });
          return {
            json: async <T>() =>
              [
                {
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
              ] as T[],
          };
        },
      }),
    });

    const page = await repository.findSummaryPage({
      tenantId: "project_1",
      traceId: "trace_1",
      limit: 1,
      cursor: { startTimeMs: 10, spanId: "span_1" },
    });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
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

  it("retries an empty first hinted page without the occurrence bound", async () => {
    const calls: string[] = [];
    const repository = ClickHouseTraceSpanRepository.create({
      resolve: async (): Promise<TraceClickHouseClient> => ({
        query: async <_Row>(input: Parameters<TraceClickHouseClient["query"]>[0]) => {
          calls.push(input.query);
          const rows =
            calls.length === 1
              ? []
              : [
                  {
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
                ];
          return { json: async <T>() => rows as T[] };
        },
      }),
    });

    const page = await repository.findSummaryPage({
      tenantId: "project_1",
      traceId: "trace_1",
      limit: 1,
      occurredAtMs: 100,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("fromUnixTimestamp64Milli({fromMs:Int64})");
    expect(calls[1]).not.toContain("fromUnixTimestamp64Milli({fromMs:Int64})");
    expect(page.rows).toHaveLength(1);
  });

  it("treats an empty cursor page as the end without an unbounded retry", async () => {
    let queryCount = 0;
    const repository = ClickHouseTraceSpanRepository.create({
      resolve: async (): Promise<TraceClickHouseClient> => ({
        query: async () => {
          queryCount += 1;
          return { json: async <T>() => [] as T[] };
        },
      }),
    });

    const page = await repository.findSummaryPage({
      tenantId: "project_1",
      traceId: "trace_1",
      limit: 1,
      cursor: { startTimeMs: 10, spanId: "span_1" },
      occurredAtMs: 100,
    });

    expect(page).toEqual({ rows: [], hasMore: false });
    expect(queryCount).toBe(1);
  });

  it("uses the live row-version delta query without an occurrence window", async () => {
    const calls: Array<{
      sql: string;
      params?: Record<string, unknown>;
    }> = [];
    const repository = ClickHouseTraceSpanRepository.create({
      resolve: async (): Promise<TraceClickHouseClient> => ({
        query: async <_Row>(input: Parameters<TraceClickHouseClient["query"]>[0]) => {
          calls.push({ sql: input.query, params: input.query_params });
          return {
            json: async <T>() =>
              [
                {
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
              ] as T[],
          };
        },
      }),
    });

    const rows = await repository.findSummarySince({
      tenantId: "project_1",
      traceId: "trace_1",
      sinceUpdatedAtMs: 29,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toEqual({
      tenantId: "project_1",
      traceId: "trace_1",
      sinceUpdatedAtMs: 29,
    });
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
