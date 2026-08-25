import type {
  TraceClickHouseClient,
  TraceClickHouseResolver,
} from "../src";
import { ModelProviderService } from "@langwatch/model-provider-contract";
import { ClickHouseTraceAdapter } from "../src";
import { ClickHouseTraceSpanRepository } from "../src/repositories/clickhouse/clickhouse.trace-span.repository";
import { describe, expect, it } from "vitest";

const resolver = (
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

class StaticModelProviders extends ModelProviderService {
  readonly inputs: unknown[] = [];

  estimateCost(input: unknown): number {
    this.inputs.push(input);
    return 0.47;
  }
  listForProject(): Promise<[]> { return Promise.resolve([]); }
  listForOrganization(): Promise<[]> { return Promise.resolve([]); }
  getForProject(): Promise<Record<string, never>> { return Promise.resolve({}); }
  upsert(): Promise<never> { throw new Error("not used"); }
  delete(): Promise<void> { return Promise.resolve(); }
  validateApiKey(): Promise<never> { throw new Error("not used"); }
  testConnection(): Promise<{ connected: boolean }> { return Promise.resolve({ connected: false }); }
  getCodexStatus(): Promise<never> { throw new Error("not used"); }
  isManagedProvider(): boolean { return false; }
  getDefaultSnapshot(): Promise<never> { throw new Error("not used"); }
  getInheritedValues(): Promise<never> { throw new Error("not used"); }
  tryGetResolvedDefault(): Promise<null> { return Promise.resolve(null); }
  setDefault(): Promise<void> { return Promise.resolve(); }
  saveDefaultConfig(): Promise<never> { throw new Error("not used"); }
  tryGetDefaultConfig(): Promise<null> { return Promise.resolve(null); }
  deleteDefaultConfig(): Promise<void> { return Promise.resolve(); }
  listCosts(): Promise<[]> { return Promise.resolve([]); }
  upsertCost(): Promise<never> { throw new Error("not used"); }
  deleteCost(): Promise<void> { return Promise.resolve(); }
  translate(): Promise<never> { throw new Error("not used"); }
}

describe("ClickHouseTraceAdapter", () => {
  it("constructs concrete repositories behind the public adapter", async () => {
    const calls: Array<{ tenantId: string; sql: string }> = [];
    const service = ClickHouseTraceAdapter.create({
      resolveClient: resolver(calls),
      modelProviders: new StaticModelProviders(),
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
    const modelProviders = new StaticModelProviders();
    const service = ClickHouseTraceAdapter.create({
      resolveClient: resolver(calls, ""),
      modelProviders,
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
    expect(modelProviders.inputs).toEqual([
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

describe("ClickHouseTraceSpanRepository page parity", () => {
  it("uses the live cursor without constraining latest-version election", async () => {
    const calls: Array<{ sql: string; params?: Record<string, unknown> }> = [];
    const repository = ClickHouseTraceSpanRepository.create(
      async (): Promise<TraceClickHouseClient> => ({
        query: async <_Row>(
          input: Parameters<TraceClickHouseClient["query"]>[0],
        ) => {
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
    );

    const page = await repository.findSummaryPage({
      tenantId: "project_1",
      traceId: "trace_1",
      limit: 1,
      cursor: { startTimeMs: 10, spanId: "span_1" },
    });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.params).toMatchObject({ cursorStart: 10, cursorSpan: "span_1" });
    expect(call.sql).toContain(
      "(toUnixTimestamp64Milli(StartTime), SpanId) > ({cursorStart:Int64}, {cursorSpan:String})",
    );
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
    const repository = ClickHouseTraceSpanRepository.create(
      async (): Promise<TraceClickHouseClient> => ({
        query: async <_Row>(
          input: Parameters<TraceClickHouseClient["query"]>[0],
        ) => {
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
    );

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

  it("uses the live row-version delta query without an occurrence window", async () => {
    const calls: Array<{
      sql: string;
      params?: Record<string, unknown>;
    }> = [];
    const repository = ClickHouseTraceSpanRepository.create(
      async (): Promise<TraceClickHouseClient> => ({
        query: async <_Row>(
          input: Parameters<TraceClickHouseClient["query"]>[0],
        ) => {
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
    );

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
