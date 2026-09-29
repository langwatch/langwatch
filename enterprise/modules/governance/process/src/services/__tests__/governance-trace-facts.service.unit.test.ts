import { describe, expect, it, vi } from "vitest";

import type {
  GovernanceKpiContribution,
  GovernanceKpiContributionWriter,
  GovernanceOcsfEvent,
  GovernanceOcsfEventWriter,
  GovernanceTraceSummary,
} from "../../app/governance.members.ts";
import { GovernanceTraceFactsService } from "../governance-trace-facts.service.ts";

const summary: GovernanceTraceSummary = {
  traceId: "trace-1",
  occurredAt: 1_700_000_123_456,
  totalCost: 0.0042,
  totalPromptTokenCount: 120,
  totalCompletionTokenCount: 42,
  models: ["model-1"],
  attributes: {
    "langwatch.origin.kind": "ingestion_source",
    "langwatch.ingestion_source.id": "source-1",
    "langwatch.ingestion_source.source_type": "otel_generic",
  },
};

function withAttributes(attributes: Record<string, string>): GovernanceTraceSummary {
  return { ...summary, attributes: { ...summary.attributes, ...attributes } };
}

/** Both tables replace by key, as the live ReplacingMergeTrees do. */
class ReplacingKpis implements GovernanceKpiContributionWriter {
  readonly rows = new Map<string, GovernanceKpiContribution>();
  failNext = false;
  async insertContribution(row: GovernanceKpiContribution): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("clickhouse unavailable");
    }
    const key = [row.tenantId, row.sourceId, row.hourBucket.epochMilliseconds, row.traceId];
    this.rows.set(key.join(":"), row);
  }
}

class ReplacingOcsf implements GovernanceOcsfEventWriter {
  readonly rows = new Map<string, GovernanceOcsfEvent>();
  async insertEvent(row: GovernanceOcsfEvent): Promise<void> {
    this.rows.set(`${row.tenantId}:${row.eventId}`, row);
  }
}

function setup() {
  const kpis = new ReplacingKpis();
  const ocsf = new ReplacingOcsf();
  const warn = vi.fn();
  const service = GovernanceTraceFactsService.create({ kpis, ocsf, diagnostics: { warn } });
  const record = (summaries: GovernanceTraceSummary[]) =>
    service.record({ tenantId: "project-1", summaries });
  return { kpis, ocsf, warn, record };
}

describe("GovernanceTraceFactsService", () => {
  it("writes nothing for a trace that is not governance-origin, names no source or has no moment", async () => {
    const { kpis, ocsf, warn, record } = setup();
    await expect(
      record([
        { ...summary, attributes: {} },
        withAttributes({ "langwatch.ingestion_source.id": "" }),
        { ...summary, occurredAt: 0 },
      ]),
    ).resolves.toEqual({ written: 0 });
    expect(kpis.rows.size + ocsf.rows.size).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
  });

  /** @scenario "A governance trace's spend lands in governance_kpis" */
  it("buckets the trace's running totals into its hour", async () => {
    const { kpis, record } = setup();
    await record([summary]);
    const [kpi] = [...kpis.rows.values()];
    expect(kpi).toMatchObject({
      tenantId: "project-1",
      sourceId: "source-1",
      sourceType: "otel_generic",
      traceId: "trace-1",
      spendUsd: 0.0042,
      promptTokens: 120,
      completionTokens: 42,
    });
    expect(kpi?.hourBucket.epochMilliseconds).toBe(1_699_999_200_000);
    expect(kpi?.lastEventOccurredAt.epochMilliseconds).toBe(summary.occurredAt);
  });

  /** @scenario "A governance trace derives one OCSF row" */
  it("keys the OCSF row by trace and elevates an alerted trace's severity", async () => {
    const { ocsf, record } = setup();
    await record([summary]);
    expect(ocsf.rows.get("project-1:trace-1")).toMatchObject({
      eventId: "trace-1",
      severityId: 1,
      activityId: 6,
      actionName: "trace.recorded",
      targetName: "model-1",
    });
    await record([withAttributes({ "langwatch.governance.anomaly_alert_id": "alert-1" })]);
    const alerted = ocsf.rows.get("project-1:trace-1");
    expect(ocsf.rows.size).toBe(1);
    expect(alerted?.severityId).toBe(4);
    expect(JSON.parse(alerted?.rawOcsfJson ?? "{}")).toMatchObject({
      type_uid: 600306,
      metadata: { extension: { trace_id: "trace-1", anomaly_alert_id: "alert-1" } },
    });
  });

  it("places a user.email that is no address in the user id column, as main did", async () => {
    const { ocsf, record } = setup();
    await record([withAttributes({ "user.email": "dana-hoffman" })]);
    expect(ocsf.rows.get("project-1:trace-1")).toMatchObject({
      actorUserId: "dana-hoffman",
      actorEmail: "",
    });
    await record([
      withAttributes({ "user.email": "dana@acme.test", "langwatch.user_id": "user-1" }),
    ]);
    expect(ocsf.rows.get("project-1:trace-1")).toMatchObject({
      actorUserId: "user-1",
      actorEmail: "dana@acme.test",
    });
  });

  /** @scenario "A governance trace whose row write fails is written again without duplicate rows" */
  it("throws on a failed write, and the re-driven trace still leaves one row of each", async () => {
    const { kpis, ocsf, record } = setup();
    kpis.failNext = true;
    await expect(record([summary])).rejects.toThrow("clickhouse unavailable");
    await record([summary]);
    await record([summary]);
    expect(kpis.rows.size).toBe(1);
    expect(ocsf.rows.size).toBe(1);
  });
});
