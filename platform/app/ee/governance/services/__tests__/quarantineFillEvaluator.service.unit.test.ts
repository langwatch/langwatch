/**
 * @vitest-environment node
 *
 * Unit coverage for QuarantineFillEvaluator — exercises the rate
 * arithmetic + threshold flag against a stubbed trace-activity
 * repository so we don't need to spin up CH for the basic contract.
 *
 * Integration coverage (live CH + populated trace_summaries) is a
 * follow-up; the rate math + threshold flag + per-source ordering
 * are the load-bearing contract for the admin UI today.
 *
 * Spec: specs/ai-gateway/governance/ingestion-attribution.feature
 *       §"Admin warning fires when quarantine fill rate exceeds threshold"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GovernanceTraceActivityClickHouseRepository } from "../governanceTraceActivity.clickhouse.repository";
import {
  QUARANTINE_DEFAULT_THRESHOLD,
  QUARANTINE_DEFAULT_WINDOW_SECONDS,
  QuarantineFillEvaluator,
} from "../quarantineFillEvaluator.service";

const ORG_ID = "org-qfe-unit";
const HIDDEN_GOV_PROJECT_ID = "gov-project-qfe-unit";

vi.mock("../governanceProject.service", () => ({
  ensureHiddenGovernanceProject: vi.fn(async () => ({
    id: HIDDEN_GOV_PROJECT_ID,
  })),
}));

function stubTraceActivity(
  rows: Array<{ sourceId: string; spanCount: number }>,
) {
  return {
    findSpanCountsBySource: vi.fn(async () => rows),
  } as unknown as GovernanceTraceActivityClickHouseRepository;
}

describe("QuarantineFillEvaluator", () => {
  const fakePrisma = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns zero rate + empty perSource on a quiescent org", async () => {
    const traceActivity = stubTraceActivity([]);
    const evaluator = QuarantineFillEvaluator.create({
      prisma: fakePrisma,
      traceActivity,
    });
    const stats = await evaluator.evaluate({ organizationId: ORG_ID });
    expect(stats).toEqual({
      windowSeconds: QUARANTINE_DEFAULT_WINDOW_SECONDS,
      threshold: QUARANTINE_DEFAULT_THRESHOLD,
      spanCount: 0,
      rate: 0,
      exceeded: false,
      perSource: [],
    });
  });

  it("computes spans/min from a 60s window", async () => {
    // 50 spans in 60s → 50 spans/min, well under the 100 threshold.
    const traceActivity = stubTraceActivity([
      { sourceId: "is-a", spanCount: 30 },
      { sourceId: "is-b", spanCount: 20 },
    ]);
    const evaluator = QuarantineFillEvaluator.create({
      prisma: fakePrisma,
      traceActivity,
    });
    const stats = await evaluator.evaluate({ organizationId: ORG_ID });
    expect(stats.spanCount).toBe(50);
    expect(stats.rate).toBe(50);
    expect(stats.exceeded).toBe(false);
    expect(stats.perSource).toEqual([
      { ingestionSourceId: "is-a", spanCount: 30 },
      { ingestionSourceId: "is-b", spanCount: 20 },
    ]);
  });

  it("normalises spans/min for non-60s windows", async () => {
    // 200 spans in 30s → 400 spans/min — above threshold.
    const traceActivity = stubTraceActivity([
      { sourceId: "is-loop", spanCount: 200 },
    ]);
    const evaluator = QuarantineFillEvaluator.create({
      prisma: fakePrisma,
      traceActivity,
    });
    const stats = await evaluator.evaluate({
      organizationId: ORG_ID,
      windowSeconds: 30,
    });
    expect(stats.windowSeconds).toBe(30);
    expect(stats.rate).toBe(400);
    expect(stats.exceeded).toBe(true);
  });

  it("flags exceeded only when rate >= threshold", async () => {
    // Threshold == rate exactly should still flag (>=).
    const traceActivity = stubTraceActivity([
      { sourceId: "is-edge", spanCount: 100 },
    ]);
    const evaluator = QuarantineFillEvaluator.create({
      prisma: fakePrisma,
      traceActivity,
    });
    const stats = await evaluator.evaluate({ organizationId: ORG_ID });
    expect(stats.rate).toBe(100);
    expect(stats.exceeded).toBe(true);
  });

  it("respects a caller-supplied threshold override", async () => {
    const traceActivity = stubTraceActivity([
      { sourceId: "is-quiet", spanCount: 30 },
    ]);
    const evaluator = QuarantineFillEvaluator.create({
      prisma: fakePrisma,
      traceActivity,
    });
    const stats = await evaluator.evaluate({
      organizationId: ORG_ID,
      threshold: 25,
    });
    expect(stats.threshold).toBe(25);
    expect(stats.exceeded).toBe(true);
  });

  it("drops rows with empty sourceId from perSource breakdown", async () => {
    // The repository returns "" for missing map keys; we shouldn't surface
    // those as anonymous-source rows in the admin UI.
    const traceActivity = stubTraceActivity([
      { sourceId: "is-real", spanCount: 40 },
      { sourceId: "", spanCount: 10 },
    ]);
    const evaluator = QuarantineFillEvaluator.create({
      prisma: fakePrisma,
      traceActivity,
    });
    const stats = await evaluator.evaluate({ organizationId: ORG_ID });
    expect(stats.perSource).toEqual([
      { ingestionSourceId: "is-real", spanCount: 40 },
    ]);
    // spanCount sum reflects only the rows we surface.
    expect(stats.spanCount).toBe(40);
  });

  it("fail-safes to zero stats on a query-time error", async () => {
    const traceActivity = {
      findSpanCountsBySource: vi.fn(async () => {
        throw new Error("clickhouse explode");
      }),
    } as unknown as GovernanceTraceActivityClickHouseRepository;
    const evaluator = QuarantineFillEvaluator.create({
      prisma: fakePrisma,
      traceActivity,
    });
    const stats = await evaluator.evaluate({ organizationId: ORG_ID });
    // Failure mode: admin dashboard sees zero rate, NOT an unhandled
    // exception that crashes the page.
    expect(stats.spanCount).toBe(0);
    expect(stats.rate).toBe(0);
    expect(stats.exceeded).toBe(false);
    expect(stats.perSource).toEqual([]);
  });

  it("throws when no ClickHouse repository is available", async () => {
    const evaluator = QuarantineFillEvaluator.create({
      prisma: fakePrisma,
      traceActivity: undefined,
    });
    // Unlike a query-time failure, "no ClickHouse at all" is not fail-safed
    // — there is no store to have read zero spans from.
    await expect(
      evaluator.evaluate({ organizationId: ORG_ID }),
    ).rejects.toThrow("ClickHouse client is not available");
  });
});
