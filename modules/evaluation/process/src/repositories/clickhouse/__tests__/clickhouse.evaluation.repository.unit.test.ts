import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import { SecurityError } from "@langwatch/eventing";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it, vi } from "vitest";

import {
  aggregateProof,
  ownProof,
} from "../../../__tests__/support/authorization-proofs.fixture.ts";
import type { EvaluationRetentionLookup } from "../../evaluation.repository.ts";
import type {
  EvaluationClickHouseClient,
  EvaluationClickHouseInsert,
  EvaluationClickHouseQuery,
} from "../clickhouse.evaluation-session.store.ts";
import { ClickHouseEvaluationRepository } from "../evaluation.repository.ts";

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

function result(rows: Record<string, unknown>[]): { json<T>(): Promise<T[]> } {
  return { json: async <T>() => rows.map((row) => row as T) };
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

type TestClient = EvaluationClickHouseClient & {
  queries: string[];
  queryParams: Record<string, unknown>[];
  inserts: unknown[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

class TestRetention implements EvaluationRetentionLookup {
  readonly getPlatformDefaultRetentionDays = vi.fn(() => 49);
  readonly findRetentionDays = vi.fn(async (): Promise<number[]> => [30]);
}

function harness(rows: Record<string, unknown>[][] = []): {
  client: TestClient;
  reader: ReturnType<typeof readerQuery>;
  floor: TestRetention;
  repository: ClickHouseEvaluationRepository;
} {
  const queue = [...rows];
  // The proof-fenced reader records into the same log and answers from the same queue.
  const reader = readerQuery(({ sql, params }) => {
    client.queries.push(sql);
    client.queryParams.push(params);
    return queue.shift() ?? [];
  });
  const client: TestClient = {
    queries: [],
    queryParams: [],
    inserts: [],
    insert: vi.fn(async (input: EvaluationClickHouseInsert) => {
      client.inserts.push(input.values[0]);
    }),
    query: vi.fn(async (input: EvaluationClickHouseQuery) => {
      client.queries.push(input.query);
      client.queryParams.push(input.query_params);
      return result(queue.shift() ?? []);
    }),
  };
  const floor = new TestRetention();
  const queryClient = clickHouseQueryClientDouble({ query: reader });
  return {
    client,
    reader,
    floor,
    repository: ClickHouseEvaluationRepository.create({
      resolveClient: async () => client,
      resolveQueryClient: async () => queryClient,
    }),
  };
}

function readerQuery(
  answer: (input: { sql: string; params: Record<string, unknown> }) => Record<string, unknown>[],
) {
  return vi.fn(async (input: { sql: string; params: Record<string, unknown> }) => ({
    rows: answer(input),
  }));
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

  /** @scenario evaluation rows stay merge-safe regardless of input size */
  it("replaces inputs beyond the row cap with a bounded truncation marker", async () => {
    const { client, repository } = harness();
    await repository.upsert({
      tenantId: "org_1",
      data: { ...run, inputs: { blob: "x".repeat(8 * 1024 * 1024 + 10) } },
    });

    const record = client.inserts[0] as Record<string, unknown>;
    expect(Buffer.byteLength(String(record.Inputs), "utf8")).toBeLessThan(1024);
    expect(JSON.parse(String(record.Inputs))).toHaveProperty("__lw_truncated");
  });

  it("validates tenants before writes and rejects mixed batches", async () => {
    const { client, repository } = harness();
    await expect(repository.upsert({ tenantId: "", data: run })).rejects.toThrow(SecurityError);
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
      repository.getByEvaluationId({
        authorization: ownProof({ projectId: "org_1" }),
        evaluationId: "evaluation_1",
        retention: floor,
      }),
    ).resolves.toMatchObject({ LastEventOccurredAt: 1_700_000_001_000 });
    expect(floor.findRetentionDays).toHaveBeenCalledWith({
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
      const { client, floor, repository } = harness([[{ scheduledAtMs }], []]);

      await expect(
        repository.getByEvaluationId({
          authorization: ownProof({ projectId: "org_1" }),
          evaluationId: "evaluation_1",
          retention: floor,
        }),
      ).rejects.toMatchObject({ code: "evaluation_not_found" });

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

  /** @scenario A fallback read is floored at the tenant's retention horizon */
  it("uses the tenant retention floor and an open upper bound after both resolver probes miss", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T12:00:00Z"));
    try {
      const { client, floor, repository } = harness([
        [{ scheduledAtMs: null }],
        [{ scheduledAtMs: null }],
        [],
      ]);
      floor.findRetentionDays.mockResolvedValueOnce([90]);
      const floorMs = Date.now() - 92 * DAY_MS;

      await expect(
        repository.getByEvaluationId({
          authorization: ownProof({ projectId: "org_1" }),
          evaluationId: "missing",
          retention: floor,
        }),
      ).rejects.toMatchObject({ code: "evaluation_not_found" });

      const resolverRequests = client.queries
        .map((query, index) => ({ query, params: client.queryParams[index]! }))
        .filter(({ query }) => query.includes("argMax(ScheduledAt"));
      expect(resolverRequests).toHaveLength(2);
      expect(resolverRequests[1]?.params.sinceMs).toBe(floorMs);

      const heavyIndex = client.queries.findIndex((query) => query.includes("PREWHERE"));
      expect(client.queries[heavyIndex]).toContain("t.ScheduledAt >=");
      expect(client.queries[heavyIndex]).not.toContain("t.ScheduledAt <=");
      expect(client.queryParams[heavyIndex]).toMatchObject({
        scheduledAtFrom: floorMs,
      });
      expect(client.queryParams[heavyIndex]).not.toHaveProperty("scheduledAtTo");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fences every run read by the proof, reading an aggregate's members, never a bare tenant", async () => {
    const row = fixtureRow({ TenantId: "member_2" });
    const { client, floor, repository } = harness([
      [{ scheduledAtMs: null }],
      [{ scheduledAtMs: null }],
      [row],
      [row],
    ]);
    const authorization = aggregateProof({
      projectId: "aggregate_1",
      members: [
        { projectId: "member_1", from: 0 },
        { projectId: "member_2", from: 0 },
      ],
    });

    await expect(
      repository.getByEvaluationId({
        authorization,
        evaluationId: "evaluation_1",
        retention: floor,
      }),
    ).resolves.toMatchObject({ evaluationId: "evaluation_1" });
    await expect(repository.findByTraceId({ authorization, traceId: "trace_1" })).resolves.toEqual([
      expect.objectContaining({ evaluationId: "evaluation_1" }),
    ]);

    // An aggregate spans several projects, so the unhinted floor is read for its own project.
    expect(floor.findRetentionDays).toHaveBeenCalledWith({
      table: "evaluation_runs",
      tenantId: "aggregate_1",
    });
    expect(client.queries).toHaveLength(4);
    for (const [index, query] of client.queries.entries()) {
      expect(query).not.toContain("{tenantId:String}");
      expect(query).not.toContain("{{tenant");
      const params = JSON.stringify(client.queryParams[index]);
      expect(params).toContain("member_1");
      expect(params).toContain("member_2");
    }
  });

  /** @scenario A single evaluation's inputs can be fetched without scanning the trace */
  it("reads one evaluation's inputs by its sort key and degrades unavailable reads", async () => {
    const { client, repository } = harness([
      [{ TenantId: "org_1", Inputs: '{"input":"hello","output":"world"}' }],
    ]);

    await expect(
      repository.findInputs({
        authorization: ownProof({ projectId: "org_1" }),
        evaluationId: "evaluation_1",
      }),
    ).resolves.toEqual({ tenantId: "org_1", inputs: { input: "hello", output: "world" } });
    expect(client.queries[0]).toContain("EvaluationId = {evaluationId:String}");
    expect(client.queries[0]).not.toContain("TraceId");
    // The tenant comes from the proof's fence, never from the caller.
    expect(client.queryParams[0]).toMatchObject({ evaluationId: "evaluation_1" });
    expect(JSON.stringify(client.queryParams[0])).toContain("org_1");

    const down = async (): Promise<never> => {
      throw new Error("ClickHouse unavailable");
    };
    const unavailable = ClickHouseEvaluationRepository.create({
      resolveClient: down,
      resolveQueryClient: down,
    });
    await expect(
      unavailable.findInputs({
        authorization: ownProof({ projectId: "org_1" }),
        evaluationId: "evaluation_1",
      }),
    ).resolves.toBeNull();
  });

  describe("given no project the proof reads holds the evaluation", () => {
    it("answers no inputs", async () => {
      const { repository } = harness([[]]);

      await expect(
        repository.findInputs({
          authorization: ownProof({ projectId: "org_1" }),
          evaluationId: "evaluation_1",
        }),
      ).resolves.toBeNull();
    });
  });

  describe("given the inputs read fails", () => {
    it("degrades the memory ceiling to none and throws any other failure", async () => {
      const { reader, repository } = harness();
      const read = () =>
        repository.findInputs({
          authorization: ownProof({ projectId: "org_1" }),
          evaluationId: "evaluation_1",
        });

      reader.mockRejectedValueOnce(new Error("Query memory limit exceeded: would use 4 GiB"));
      await expect(read()).resolves.toBeNull();

      reader.mockRejectedValueOnce(new Error("Code: 62. Syntax error"));
      await expect(read()).rejects.toThrow("Code: 62");
    });
  });
});
