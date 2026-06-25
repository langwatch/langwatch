/**
 * Integration tests for `getByEvaluationId` partition pruning on a real
 * ClickHouse testcontainer (production `evaluation_runs` schema:
 * `ReplacingMergeTree(UpdatedAt)`, `PARTITION BY toYearWeek(ScheduledAt)`,
 * `ORDER BY (TenantId, EvaluationId)`).
 *
 * The heavy ZSTD(3) columns (Inputs / Details / Error / ErrorDetails) are only
 * pruned to the eval's partition when a `ScheduledAt` predicate is present.
 * Callers that don't thread a `scheduledAt` hint (event-sourcing projection
 * reads) used to scan every weekly partition incl. cold S3; the reader now
 * resolves ScheduledAt from a cheap sort-key seek and bounds the read.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestClickHouseClient } from "../../../../event-sourcing/__tests__/integration/testContainers";
import type { EvaluationRunData } from "../../types";
import { EvaluationRunClickHouseRepository } from "../evaluation-run.clickhouse.repository";

const tenantId = `test-eval-resolve-${nanoid()}`;
const base = Date.now() - 60 * 60 * 1000;

let ch: ClickHouseClient;
let repo: EvaluationRunClickHouseRepository;

function makeEval(
  evaluationId: string,
  overrides: Partial<EvaluationRunData> = {},
): EvaluationRunData {
  return {
    evaluationId,
    evaluatorId: "evaluator-1",
    evaluatorType: "test/evaluator",
    evaluatorName: "Test Evaluator",
    traceId: `trace-${nanoid()}`,
    isGuardrail: false,
    status: "processed",
    score: 1,
    passed: true,
    label: null,
    details: "ok",
    inputs: { input: "x" },
    error: null,
    errorDetails: null,
    createdAt: base,
    updatedAt: base,
    LastEventOccurredAt: base,
    archivedAt: null,
    scheduledAt: base,
    startedAt: base,
    completedAt: base,
    costId: null,
    ...overrides,
  };
}

beforeAll(async () => {
  const rawClient = getTestClickHouseClient();
  if (!rawClient) throw new Error("ClickHouse test container not available");
  ch = rawClient;
  repo = new EvaluationRunClickHouseRepository(async () => ch);

  // Two versions of the same evaluation: the dedup must return the latest
  // (v2), and the ScheduledAt resolve (argMax over UpdatedAt) must pick v2's
  // ScheduledAt = `base`.
  await repo.upsert(makeEval("eval-resolve-1", { score: 1 }), tenantId);
  await repo.upsert(
    makeEval("eval-resolve-1", { score: 2, updatedAt: base + 1000 }),
    tenantId,
  );
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query:
        "ALTER TABLE evaluation_runs DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  }
});

describe("EvaluationRunClickHouseRepository.getByEvaluationId (integration)", () => {
  it("returns the latest version when no ScheduledAt hint is passed", async () => {
    const result = await repo.getByEvaluationId({
      tenantId,
      evaluationId: "eval-resolve-1",
    });

    expect(result).not.toBeNull();
    expect(result?.score).toBe(2);
  });

  it("resolves ScheduledAt and bounds the heavy read to the eval's partition", async () => {
    const queries: string[] = [];
    const recordingClient = new Proxy(ch, {
      get(target, prop, receiver) {
        if (prop === "query") {
          return (args: { query: string; query_params?: unknown }) => {
            if (args.query.includes("evaluation_runs")) {
              queries.push(args.query);
            }
            return (target as ClickHouseClient).query(args as never);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as ClickHouseClient;
    const recordingRepo = new EvaluationRunClickHouseRepository(
      async () => recordingClient,
    );

    const result = await recordingRepo.getByEvaluationId({
      tenantId,
      evaluationId: "eval-resolve-1",
    });

    expect(result?.score).toBe(2);
    // One cheap resolve (argMax ScheduledAt) + the heavy read, and the heavy
    // read is partition-bounded on ScheduledAt rather than unbounded.
    expect(queries).toHaveLength(2);
    const resolveQuery = queries.find((q) => q.includes("argMax(ScheduledAt"));
    const heavyQuery = queries.find((q) => q.includes("PREWHERE"));
    expect(resolveQuery).toBeDefined();
    expect(heavyQuery).toBeDefined();
    expect(heavyQuery!).toContain("ScheduledAt >=");
  });

  it("returns null and stays unbounded for an evaluation that does not exist", async () => {
    const queries: string[] = [];
    const recordingClient = new Proxy(ch, {
      get(target, prop, receiver) {
        if (prop === "query") {
          return (args: { query: string; query_params?: unknown }) => {
            if (args.query.includes("evaluation_runs")) {
              queries.push(args.query);
            }
            return (target as ClickHouseClient).query(args as never);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as ClickHouseClient;
    const recordingRepo = new EvaluationRunClickHouseRepository(
      async () => recordingClient,
    );

    const result = await recordingRepo.getByEvaluationId({
      tenantId,
      evaluationId: `missing-${nanoid()}`,
    });

    expect(result).toBeNull();
    // Resolve finds nothing (epoch default), so the heavy read keeps its
    // previous unbounded behaviour rather than guessing a window.
    const heavyQuery = queries.find((q) => q.includes("PREWHERE"));
    expect(heavyQuery).toBeDefined();
    expect(heavyQuery!).not.toContain("ScheduledAt >=");
  });
});
