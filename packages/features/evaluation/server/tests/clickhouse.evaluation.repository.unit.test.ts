import { describe, expect, it, vi } from "vitest";
import { ClickHouseEvaluationRepository } from "../src/repositories/clickhouse/clickhouse.evaluation.repository";
import type {
  EvaluationClickHouseClient,
  EvaluationRetentionFloorPort,
} from "../src/ports/evaluation.port";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";

const run: EvaluationRunData = {
  evaluationId: "evaluation_1",
  evaluatorId: "evaluator_1",
  evaluatorType: "native",
  evaluatorName: "Quality",
  traceId: "trace_1",
  isGuardrail: false,
  status: "processed",
  score: 0.9,
  passed: true,
  label: "pass",
  details: "details",
  inputs: { query: "hello" },
  error: null,
  errorDetails: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
  LastEventOccurredAt: 1_700_000_001_000,
  archivedAt: null,
  scheduledAt: 1_700_000_000_000,
  startedAt: 1_700_000_000_100,
  completedAt: 1_700_000_001_000,
  costId: null,
};

function result(rows: unknown[]): { json<T>(): Promise<T[]> } {
  return { json: async <T>() => rows as T[] };
}

function fixtureRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ProjectionId: "projection_1",
    TenantId: "org_1",
    EvaluationId: "evaluation_1",
    Version: "2025-01-14",
    EvaluatorId: "evaluator_1",
    EvaluatorType: "native",
    EvaluatorName: "Quality",
    TraceId: "trace_1",
    IsGuardrail: 0,
    Status: "processed",
    Score: 0.9,
    Passed: 1,
    Label: "pass",
    Details: "details",
    Inputs: '{"query":"hello"}',
    Error: null,
    ErrorDetails: null,
    CreatedAt: 1_700_000_000_000,
    UpdatedAt: 1_700_000_001_000,
    ArchivedAt: null,
    ScheduledAt: 1_700_000_000_000,
    StartedAt: 1_700_000_000_100,
    CompletedAt: 1_700_000_001_000,
    CostId: null,
    LastProcessedEventId: "projection_1",
    LastEventOccurredAt: 1_700_000_001_000,
    _retention_days: 49,
    ...overrides,
  };
}

function harness(rows: unknown[][] = []): {
  client: EvaluationClickHouseClient & {
    queries: string[];
    queryParams: Array<Record<string, unknown>>;
    inserts: unknown[];
  };
  floor: EvaluationRetentionFloorPort & { getFloorMs: ReturnType<typeof vi.fn> };
  repository: ClickHouseEvaluationRepository;
} {
  const queue = [...rows];
  const client = {
    queries: [],
    queryParams: [],
    inserts: [],
    insert: vi.fn(async (input: { values: unknown[] }) => {
      client.inserts.push(input.values[0]);
    }),
    query: vi.fn(
      async (input: { query: string; query_params: Record<string, unknown> }) => {
        client.queries.push(input.query);
        client.queryParams.push(input.query_params);
        return result(queue.shift() ?? []);
      },
    ),
  } as unknown as EvaluationClickHouseClient & {
    queries: string[];
    queryParams: Array<Record<string, unknown>>;
    inserts: unknown[];
  };
  const floor = {
    getFloorMs: vi.fn(async () => 1_600_000_000_000),
  } as EvaluationRetentionFloorPort & { getFloorMs: ReturnType<typeof vi.fn> };
  return {
    client,
    floor,
    repository: ClickHouseEvaluationRepository.create({
      resolveClient: async () => client,
      retentionFloor: floor,
    }),
  };
}

describe("ClickHouseEvaluationRepository", () => {
  it("writes deterministic projection metadata, event cursor, retention and capped payloads", async () => {
    const { client, repository } = harness();
    const oversized = "x".repeat(256 * 1024 + 10);
    await repository.upsert({
      tenantId: "org_1",
      data: { ...run, details: oversized, error: oversized },
      retentionDays: 31,
    });

    const record = client.inserts[0] as Record<string, unknown>;
    expect(record.ProjectionId).not.toBe(run.evaluationId);
    expect(record.Version).toBe("2025-01-14");
    expect(record.LastProcessedEventId).toBe(record.ProjectionId);
    expect(record.LastEventOccurredAt).toEqual(new Date(run.LastEventOccurredAt));
    expect(record._retention_days).toBe(31);
    expect(String(record.Details)).toContain("[lw-truncated]");
    expect(String(record.Error)).toContain("[lw-truncated]");
  });

  it("validates tenants before writes and rejects mixed batches", async () => {
    const { client, repository } = harness();
    await expect(repository.upsert({ tenantId: "", data: run })).rejects.toThrow();
    await expect(
      repository.upsertBatch([
        { tenantId: "org_1", data: run },
        { tenantId: "org_2", data: run },
      ]),
    ).rejects.toThrow(/Mixed tenants/);
    expect(client.inserts).toHaveLength(0);
  });

  it("probes ScheduledAt recent-first and bounds the heavy deduplicated read at retention", async () => {
    const row = fixtureRow();
    const { client, floor, repository } = harness([
      [{ scheduledAtMs: null }],
      [{ scheduledAtMs: null }],
      [row],
    ]);
    await expect(
      repository.tryFindByEvaluationId({
        tenantId: "org_1",
        evaluationId: "evaluation_1",
      }),
    ).resolves.toMatchObject({ LastEventOccurredAt: 1_700_000_001_000 });
    expect(floor.getFloorMs).toHaveBeenCalledWith({
      table: "evaluation_runs",
      tenantId: "org_1",
    });
    expect(client.queries[0]).toContain("argMax(ScheduledAt, UpdatedAt)");
    expect(client.queries.at(-1)).toContain("PREWHERE");
    expect(client.queries.at(-1)).toContain("scheduledAtFrom");
    expect(client.queries.at(-1)).toContain("max(UpdatedAt)");
  });

  it("uses one bounded resolver query when the evaluation is recent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T12:00:00Z"));
    try {
      const scheduledAtMs = Date.now() - 60_000;
      const { client, repository } = harness([[{ scheduledAtMs }], []]);

      await repository.tryFindByEvaluationId({
        tenantId: "org_1",
        evaluationId: "evaluation_1",
      });

      const resolverQueries = client.queries.filter((query) =>
        query.includes("argMax(ScheduledAt"),
      );
      expect(resolverQueries).toHaveLength(1);
      expect(resolverQueries[0]).toContain("ScheduledAt >=");
      expect(client.queryParams[0]).toMatchObject({
        sinceMs: expect.any(Number),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the tenant retention floor and an open upper bound after both resolver probes miss", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T12:00:00Z"));
    try {
      const { client, floor, repository } = harness([
        [{ scheduledAtMs: null }],
        [{ scheduledAtMs: null }],
        [],
      ]);
      floor.getFloorMs.mockResolvedValueOnce(1_500_000_000_000);

      await repository.tryFindByEvaluationId({
        tenantId: "org_1",
        evaluationId: "missing",
      });

      const resolverRequests = client.queries
        .map((query, index) => ({ query, params: client.queryParams[index]! }))
        .filter(({ query }) => query.includes("argMax(ScheduledAt"));
      expect(resolverRequests).toHaveLength(2);
      expect(resolverRequests[1]?.params.sinceMs).toBe(1_500_000_000_000);

      const heavyIndex = client.queries.findIndex((query) => query.includes("PREWHERE"));
      expect(client.queries[heavyIndex]).toContain("t.ScheduledAt >=");
      expect(client.queries[heavyIndex]).not.toContain("t.ScheduledAt <=");
      expect(client.queryParams[heavyIndex]).toMatchObject({
        scheduledAtFrom: 1_500_000_000_000,
      });
      expect(client.queryParams[heavyIndex]).not.toHaveProperty("scheduledAtTo");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps trace reads newest-first and summaries exactly deduplicated in ClickHouse", async () => {
    const { client, repository } = harness([
      [fixtureRow({ EvaluationId: "new", UpdatedAt: 20 })],
      [
        fixtureRow({ EvaluationId: "evaluation_1", TraceId: "trace_1" }),
        fixtureRow({ EvaluationId: "evaluation_2", TraceId: "trace_1", Label: "second" }),
      ],
    ]);
    await expect(
      repository.findByTraceId({ tenantId: "org_1", traceId: "trace_1" }),
    ).resolves.toHaveLength(1);
    const summaries = await repository.findSummariesByTraceIds({
      tenantId: "org_1",
      traceIds: ["trace_1"],
      since: 1_600_000_000_000,
    });
    expect(summaries.trace_1).toHaveLength(2);
    expect(client.queries[0]).toContain("ORDER BY UpdatedAt DESC");
    expect(client.queries[0]).toContain("max(UpdatedAt)");
    expect(client.queries[1]).toContain("TraceId IN");
    expect(client.queries[1]).toContain("max(UpdatedAt)");
  });

  it("degrades a per-trace read to its light projection when inputs exceed memory", async () => {
    const { client, repository } = harness();
    const lightRow = fixtureRow();
    delete lightRow.Inputs;
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error("Memory limit exceeded"))
      .mockResolvedValueOnce(result([lightRow]));
    client.query = query;

    await expect(
      repository.findTraceEvaluations({
        tenantId: "org_1",
        traceIds: ["trace_1"],
      }),
    ).resolves.toMatchObject({
      trace_1: [{ evaluationId: "evaluation_1" }],
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0].query).not.toContain("Inputs");
  });

  it("reads one evaluation's inputs by its sort key and degrades unavailable reads", async () => {
    const { client, repository } = harness([
      [{ Inputs: '{"input":"hello","output":"world"}' }],
    ]);

    await expect(
      repository.tryFindInputs({
        tenantId: "org_1",
        evaluationId: "evaluation_1",
      }),
    ).resolves.toEqual({ input: "hello", output: "world" });
    expect(client.queries[0]).toContain("EvaluationId = {evaluationId:String}");
    expect(client.queries[0]).not.toContain("TraceId");

    const unavailable = ClickHouseEvaluationRepository.create({
      resolveClient: async () => {
        throw new Error("ClickHouse unavailable");
      },
      retentionFloor: {
        getFloorMs: async () => 1_600_000_000_000,
      },
    });
    await expect(
      unavailable.tryFindInputs({
        tenantId: "org_1",
        evaluationId: "evaluation_1",
      }),
    ).resolves.toBeNull();
  });
});
