import {
  QUARANTINE_DEFAULT_THRESHOLD,
  QUARANTINE_DEFAULT_WINDOW_SECONDS,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it, vi } from "vitest";
import {
  QuarantineTenantResolver,
  QuarantineTraceActivityReader,
} from "../../app/governance.infrastructure.ts";
import { QuarantineFillEvaluatorService } from "../quarantine-fill.service.ts";

const ORGANIZATION_ID = "org-qfe-unit";

class FixedTenantResolver implements QuarantineTenantResolver {
  async resolveTenantId(): Promise<string> {
    return "governance-project-qfe-unit";
  }
}

class StubTraceActivityReader implements QuarantineTraceActivityReader {
  constructor(private readonly rows: Array<{ sourceId: string; spanCount: number }>) {}

  async findSpanCountsBySource() {
    return this.rows;
  }
}

const evaluator = (traceActivity?: QuarantineTraceActivityReader): QuarantineFillEvaluatorService =>
  QuarantineFillEvaluatorService.create({
    tenant: new FixedTenantResolver(),
    traceActivity,
    now: () => 120_000,
  });

describe("QuarantineFillEvaluatorService", () => {
  it("returns zero rate for a quiescent organization", async () => {
    await expect(
      evaluator(new StubTraceActivityReader([])).evaluate({
        organizationId: ORGANIZATION_ID,
      }),
    ).resolves.toEqual({
      windowSeconds: QUARANTINE_DEFAULT_WINDOW_SECONDS,
      threshold: QUARANTINE_DEFAULT_THRESHOLD,
      spanCount: 0,
      rate: 0,
      exceeded: false,
      perSource: [],
    });
  });

  /** @scenario "Governance evaluates quarantine fill without owning trace storage" */
  it("computes spans per minute and the default threshold", async () => {
    const stats = await evaluator(
      new StubTraceActivityReader([
        { sourceId: "source-a", spanCount: 60 },
        { sourceId: "source-b", spanCount: 40 },
      ]),
    ).evaluate({ organizationId: ORGANIZATION_ID });

    expect(stats.spanCount).toBe(100);
    expect(stats.rate).toBe(100);
    expect(stats.exceeded).toBe(true);
  });

  it("normalises non-default windows and respects threshold overrides", async () => {
    const stats = await evaluator(
      new StubTraceActivityReader([{ sourceId: "source", spanCount: 30 }]),
    ).evaluate({
      organizationId: ORGANIZATION_ID,
      windowSeconds: 30,
      threshold: 50,
    });

    expect(stats.rate).toBe(60);
    expect(stats.exceeded).toBe(true);
  });

  /** @scenario "Governance evaluates quarantine fill without owning trace storage" */
  it("drops unattributed rows from both the breakdown and total", async () => {
    const stats = await evaluator(
      new StubTraceActivityReader([
        { sourceId: "source", spanCount: 40 },
        { sourceId: "", spanCount: 10 },
      ]),
    ).evaluate({ organizationId: ORGANIZATION_ID });

    expect(stats.spanCount).toBe(40);
    expect(stats.perSource).toEqual([{ ingestionSourceId: "source", spanCount: 40 }]);
  });

  it("fail-safes to zero stats when ClickHouse rejects the query", async () => {
    const traceActivity = new StubTraceActivityReader([]);
    vi.spyOn(traceActivity, "findSpanCountsBySource").mockRejectedValue(
      new Error("clickhouse unavailable"),
    );

    const stats = await evaluator(traceActivity).evaluate({
      organizationId: ORGANIZATION_ID,
    });

    expect(stats).toMatchObject({ spanCount: 0, rate: 0, exceeded: false });
  });

  /** @scenario "Governance evaluates quarantine fill without owning trace storage" */
  it("rejects composition without a ClickHouse capability", async () => {
    await expect(evaluator().evaluate({ organizationId: ORGANIZATION_ID })).rejects.toThrow(
      "ClickHouse client is not available",
    );
  });
});
