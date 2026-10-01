import { createApiFixture } from "@langwatch/api-fixture";
import {
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
  QUARANTINE_DEFAULT_THRESHOLD,
  QUARANTINE_DEFAULT_WINDOW_SECONDS,
} from "@langwatch/enterprise-governance-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import type { QuarantineTenantResolver } from "../../app/governance.members.ts";
import { QuarantineFillEvaluatorService } from "../quarantine-fill.service.ts";

const ORGANIZATION_ID = "org-qfe-unit";

class FixedTenantResolver implements QuarantineTenantResolver {
  async resolveTenantId(): Promise<string> {
    return "governance-project-qfe-unit";
  }
}

function tracesCounting(rows: { sourceId: string; spanCount: number }[]) {
  return createApiFixture<TraceApi>({
    findTraceCountsByAttribute: vi.fn(async () =>
      rows.map(({ sourceId, spanCount }) => ({ value: sourceId, count: spanCount })),
    ),
  });
}

const evaluator = (traces: Pick<TraceApi, "findTraceCountsByAttribute">) =>
  QuarantineFillEvaluatorService.create({
    tenant: new FixedTenantResolver(),
    traces,
    now: () => 120_000,
  });

describe("QuarantineFillEvaluatorService", () => {
  it("returns zero rate for a quiescent organization", async () => {
    await expect(
      evaluator(tracesCounting([])).evaluate({
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
      tracesCounting([
        { sourceId: "source-a", spanCount: 60 },
        { sourceId: "source-b", spanCount: 40 },
      ]),
    ).evaluate({ organizationId: ORGANIZATION_ID });

    expect(stats.spanCount).toBe(100);
    expect(stats.rate).toBe(100);
    expect(stats.exceeded).toBe(true);
  });

  it("normalises non-default windows and respects threshold overrides", async () => {
    const stats = await evaluator(tracesCounting([{ sourceId: "source", spanCount: 30 }])).evaluate(
      {
        organizationId: ORGANIZATION_ID,
        windowSeconds: 30,
        threshold: 50,
      },
    );

    expect(stats.rate).toBe(60);
    expect(stats.exceeded).toBe(true);
  });

  /** @scenario "Governance evaluates quarantine fill without owning trace storage" */
  it("drops unattributed rows from both the breakdown and total", async () => {
    const stats = await evaluator(
      tracesCounting([
        { sourceId: "source", spanCount: 40 },
        { sourceId: "", spanCount: 10 },
      ]),
    ).evaluate({ organizationId: ORGANIZATION_ID });

    expect(stats.spanCount).toBe(40);
    expect(stats.perSource).toEqual([{ ingestionSourceId: "source", spanCount: 40 }]);
  });

  it("fail-safes to zero stats when ClickHouse rejects the query", async () => {
    const traces = createApiFixture<TraceApi>({
      findTraceCountsByAttribute: vi.fn().mockRejectedValue(new Error("clickhouse unavailable")),
    });

    const stats = await evaluator(traces).evaluate({
      organizationId: ORGANIZATION_ID,
    });

    expect(stats).toMatchObject({ spanCount: 0, rate: 0, exceeded: false });
  });

  /** @scenario "Governance evaluates quarantine fill without owning trace storage" */
  it("asks the trace owner for governance-origin rows grouped by ingestion source", async () => {
    const findTraceCountsByAttribute = vi.fn(async () => []);

    await evaluator(createApiFixture<TraceApi>({ findTraceCountsByAttribute })).evaluate({
      organizationId: ORGANIZATION_ID,
    });

    expect(findTraceCountsByAttribute).toHaveBeenCalledWith({
      projectId: "governance-project-qfe-unit",
      sinceMs: 120_000 - QUARANTINE_DEFAULT_WINDOW_SECONDS * 1_000,
      attribute: { key: GOVERNANCE_ATTR.ORIGIN_KIND, value: GOVERNANCE_ORIGIN_KIND_VALUE },
      groupByKey: GOVERNANCE_ATTR.INGESTION_SOURCE_ID,
    });
  });
});
