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
import { narrowAuthorization } from "@langwatch/actor";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EvaluationRunClickHouseRepository } from "~/server/app-layer/evaluations/repositories/evaluation-run.clickhouse.repository";
import { aggregateProof, ownProof } from "~/test-utils/authorizationProofs";
import { evaluationRunRepositoryFor } from "~/test-utils/evaluationRunRepository";
import { getTestClickHouseClient } from "../../../../event-sourcing/__tests__/integration/testContainers";
import type { EvaluationRunData } from "../../types";

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
  repo = evaluationRunRepositoryFor({
    resolveClient: async () => ch,
  });

  // Two versions of the same evaluation: the dedup must return the latest
  // (v2), and the ScheduledAt resolve (argMax over UpdatedAt) must pick v2's
  // ScheduledAt = `base`. v1's ScheduledAt sits 30 days back — outside the
  // ±7-day resolve window — so if the resolver picked the wrong version the
  // bounded read would land on the wrong partition and miss the row, failing
  // the latest-version assertion below.
  const staleScheduledAt = base - 30 * 24 * 60 * 60 * 1000;
  await repo.upsert(
    makeEval("eval-resolve-1", { score: 1, scheduledAt: staleScheduledAt }),
    tenantId,
  );
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
      authorization: ownProof({ projectId: tenantId }),
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
    const recordingRepo = evaluationRunRepositoryFor({
      resolveClient: async () => recordingClient,
    });

    const result = await recordingRepo.getByEvaluationId({
      authorization: ownProof({ projectId: tenantId }),
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

  it("returns null and stays bounded for an evaluation that does not exist", async () => {
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
    const recordingRepo = evaluationRunRepositoryFor({
      resolveClient: async () => recordingClient,
    });

    const result = await recordingRepo.getByEvaluationId({
      authorization: ownProof({ projectId: tenantId }),
      evaluationId: `missing-${nanoid()}`,
    });

    expect(result).toBeNull();
    // Resolve finds nothing (epoch default). The heavy read is floored at the
    // tenant's retention horizon rather than left unbounded: a miss means the
    // resolver already searched `>= floor` with no upper bound and found
    // nothing, so no row above the floor exists for this read to find either,
    // and an unbounded scan here was the largest single source of cold-scan
    // queries in production.
    const heavyQuery = queries.find((q) => q.includes("PREWHERE"));
    expect(heavyQuery).toBeDefined();
    expect(heavyQuery!).toContain("ScheduledAt >=");
    // Open-ended above, so an evaluation scheduled into the future is still
    // findable.
    expect(heavyQuery!).not.toContain("ScheduledAt <=");
  });
});

describe("EvaluationRunClickHouseRepository.findByTraceId (integration)", () => {
  const traceId = `trace-find-${nanoid()}`;

  beforeAll(async () => {
    await repo.upsert(
      makeEval("eval-find-1", {
        traceId,
        evaluatorId: "monitor-a",
        passed: true,
      }),
      tenantId,
    );
    await repo.upsert(
      makeEval("eval-find-1", {
        traceId,
        evaluatorId: "monitor-a",
        passed: false,
        updatedAt: base + 1000,
      }),
      tenantId,
    );
    await repo.upsert(
      makeEval("eval-find-2", {
        traceId,
        evaluatorId: "monitor-b",
        score: 0.4,
      }),
      tenantId,
    );
    await repo.upsert(makeEval("eval-find-other-trace"), tenantId);
  }, 60_000);

  describe("when the trace has evaluation runs", () => {
    it("returns the latest version of each run on that trace", async () => {
      const runs = await repo.findByTraceId({
        authorization: ownProof({ projectId: tenantId }),
        traceId,
      });

      expect(
        runs
          .map((run) => ({
            evaluationId: run.evaluationId,
            evaluatorId: run.evaluatorId,
            passed: run.passed,
            updatedAt: run.updatedAt,
            scheduledAt: run.scheduledAt,
          }))
          .sort((a, b) => a.evaluationId.localeCompare(b.evaluationId)),
      ).toEqual([
        {
          evaluationId: "eval-find-1",
          evaluatorId: "monitor-a",
          passed: false,
          updatedAt: base + 1000,
          scheduledAt: base,
        },
        {
          evaluationId: "eval-find-2",
          evaluatorId: "monitor-b",
          passed: true,
          updatedAt: base,
          scheduledAt: base,
        },
      ]);
    });
  });

  describe("when the trace has no evaluation runs", () => {
    it("returns nothing", async () => {
      expect(
        await repo.findByTraceId({
          authorization: ownProof({ projectId: tenantId }),
          traceId: `trace-none-${nanoid()}`,
        }),
      ).toEqual([]);
    });
  });
});

describe("EvaluationRunClickHouseRepository.findByTraceId under an aggregate's proof (integration)", () => {
  const aggregate = `test-eval-aggregate-${nanoid()}`;
  const memberA = `test-eval-member-a-${nanoid()}`;
  const memberB = `test-eval-member-b-${nanoid()}`;
  const outsider = `test-eval-outsider-${nanoid()}`;
  const sharedTraceId = `trace-shared-${nanoid()}`;
  const proof = () =>
    aggregateProof({
      projectId: aggregate,
      members: [
        { projectId: memberA, from: 0 },
        { projectId: memberB, from: 0 },
      ],
    });

  beforeAll(async () => {
    await repo.upsert(
      makeEval(`eval-a-${nanoid()}`, {
        traceId: sharedTraceId,
        evaluatorId: "monitor-a",
      }),
      memberA,
    );
    await repo.upsert(
      makeEval(`eval-b-${nanoid()}`, {
        traceId: sharedTraceId,
        evaluatorId: "monitor-b",
      }),
      memberB,
    );
    await repo.upsert(
      makeEval(`eval-out-${nanoid()}`, {
        traceId: sharedTraceId,
        evaluatorId: "monitor-out",
      }),
      outsider,
    );
  }, 60_000);

  afterAll(async () => {
    await ch.exec({
      query:
        "ALTER TABLE evaluation_runs DELETE WHERE TenantId IN ({tenants:Array(String)})",
      query_params: { tenants: [memberA, memberB, outsider] },
    });
  });

  describe("when the proof is narrowed to the member that holds the trace", () => {
    /** @scenario "The owner's existing evaluation results show on a member trace" */
    it("returns that member's evaluation and not the other member's of the same trace id", async () => {
      const narrowed = narrowAuthorization({
        authorization: proof(),
        projectId: memberA,
      });
      if (!narrowed) throw new Error("expected member A in the proof");

      const runs = await repo.findByTraceId({
        authorization: narrowed,
        traceId: sharedTraceId,
      });

      expect(runs.map((run) => run.evaluatorId)).toEqual(["monitor-a"]);
    });
  });

  describe("when the proof spans every member", () => {
    it("reads each member's evaluation and nothing from outside the proof", async () => {
      const runs = await repo.findByTraceId({
        authorization: proof(),
        traceId: sharedTraceId,
      });

      expect(runs.map((run) => run.evaluatorId).sort()).toEqual([
        "monitor-a",
        "monitor-b",
      ]);
    });
  });
});
