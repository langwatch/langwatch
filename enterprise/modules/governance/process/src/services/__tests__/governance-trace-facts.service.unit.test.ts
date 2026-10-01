import type { ProjectApi } from "@langwatch/project-contract";
import type { TraceApi, TraceSummaryData } from "@langwatch/trace-contract";
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

/** The rest of a summary the list read answers, which the rows never read. */
const fullSummary: TraceSummaryData = {
  ...summary,
  spanCount: 1,
  totalDurationMs: 100,
  computedIOSchemaVersion: "1",
  computedInput: null,
  computedOutput: null,
  timeToFirstTokenMs: null,
  timeToLastTokenMs: null,
  tokensPerSecond: null,
  containsErrorStatus: false,
  containsOKStatus: true,
  errorMessage: null,
  nonBilledCost: null,
  tokensEstimated: false,
  outputFromRootSpan: false,
  outputSpanEndTimeMs: 0,
  blockedByGuardrail: false,
  rootSpanType: null,
  containsAi: true,
  containsPrompt: false,
  selectedPromptId: null,
  selectedPromptSpanId: null,
  selectedPromptStartTimeMs: null,
  lastUsedPromptId: null,
  lastUsedPromptVersionNumber: null,
  lastUsedPromptVersionId: null,
  lastUsedPromptSpanId: null,
  lastUsedPromptStartTimeMs: null,
  topicId: null,
  subTopicId: null,
  annotationIds: [],
  traceName: "",
  createdAt: 1,
  updatedAt: 2,
  LastEventOccurredAt: 1,
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

type SummaryPages = Record<string, { summaries: GovernanceTraceSummary[]; scrollId?: string }[]>;

/** Answers each tenant's pages in order, the way the list read's scroll cursor does. */
function traceReads(pages: SummaryPages) {
  const listTraceSummaries = vi.fn<TraceApi["listTraceSummaries"]>(async ({ query }) => {
    const page = pages[query.projectId]?.shift() ?? { summaries: [] };
    return {
      ...page,
      summaries: page.summaries.map((summary): TraceSummaryData => ({
        ...fullSummary,
        ...summary,
      })),
    };
  });
  const compileLangWatchQLTraceFilter = vi.fn<TraceApi["compileLangWatchQLTraceFilter"]>(() => ({
    kind: "compiled",
    sql: "Attributes[{attrKey_0:String}] = {attrValue_1:String}",
    parameters: { attrKey_0: "langwatch.origin.kind", attrValue_1: "ingestion_source" },
  }));
  return { listTraceSummaries, compileLangWatchQLTraceFilter };
}

function setup(pages: SummaryPages = {}) {
  const kpis = new ReplacingKpis();
  const ocsf = new ReplacingOcsf();
  const warn = vi.fn();
  const traces = traceReads(pages);
  const projects: Pick<ProjectApi, "findInternalIds"> = {
    findInternalIds: async () => Object.keys(pages),
  };
  const service = GovernanceTraceFactsService.create({
    kpis,
    ocsf,
    traces,
    projects,
    diagnostics: { warn },
  });
  const record = (summaries: GovernanceTraceSummary[]) =>
    service.record({ tenantId: "project-1", summaries });
  return { kpis, ocsf, warn, record, traces, service };
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

  /** @scenario An actor the trace names by an opaque id is exported as a user id, never as an email */
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

  /** @scenario An opaque email attribute beside a user id attribute is dropped, not exported as an email */
  it("keeps the user id attribute and writes the opaque email to neither actor field", async () => {
    const { ocsf, record } = setup();
    await record([withAttributes({ "user.email": "dana-hoffman", "langwatch.user_id": "user-1" })]);

    const row = ocsf.rows.get("project-1:trace-1");

    expect(row).toMatchObject({ actorUserId: "user-1", actorEmail: "" });
    expect(row?.rawOcsfJson).not.toContain("dana-hoffman");
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

  describe("when a pass pulls a window", () => {
    it("lists every governance tenant's governance-origin summaries on the updated axis, page by page", async () => {
      const { kpis, ocsf, traces, service } = setup({
        "tenant-a": [
          { summaries: [summary], scrollId: "next" },
          { summaries: [{ ...summary, traceId: "trace-2" }] },
        ],
        "tenant-b": [{ summaries: [summary] }],
      });

      await expect(service.pull({ fromMs: 1_000, toMs: 2_000 })).resolves.toEqual({ written: 3 });

      expect(traces.compileLangWatchQLTraceFilter).toHaveBeenCalledOnce();
      expect(traces.compileLangWatchQLTraceFilter).toHaveBeenCalledWith({
        filter: "trace.attribute.langwatch.origin.kind:ingestion_source",
      });
      expect(traces.listTraceSummaries.mock.calls.map(([input]) => input)).toEqual([
        expect.objectContaining({
          query: expect.objectContaining({
            projectId: "tenant-a",
            startDate: 1_000,
            endDate: 2_000,
          }),
          options: expect.objectContaining({ dateField: "updated", scrollId: null }),
        }),
        expect.objectContaining({ options: expect.objectContaining({ scrollId: "next" }) }),
        expect.objectContaining({ query: expect.objectContaining({ projectId: "tenant-b" }) }),
      ]);
      expect(kpis.rows.size).toBe(3);
      expect(ocsf.rows.size).toBe(3);
    });

    /** @scenario "A governance trace summary read that fails is re-driven without duplicate rows" */
    it("fails the pass when the read fails, and the re-driven window leaves one row of each", async () => {
      const { kpis, ocsf, traces, service } = setup({
        "tenant-a": [{ summaries: [summary] }, { summaries: [summary] }],
      });
      traces.listTraceSummaries.mockRejectedValueOnce(new Error("clickhouse unavailable"));

      await expect(service.pull({ fromMs: 1_000, toMs: 2_000 })).rejects.toThrow(
        "clickhouse unavailable",
      );
      await service.pull({ fromMs: 1_000, toMs: 2_000 });
      await service.pull({ fromMs: 1_000, toMs: 2_000 });

      expect(kpis.rows.size).toBe(1);
      expect(ocsf.rows.size).toBe(1);
    });

    it("refuses to pull when the origin filter does not compile, rather than reading every trace", async () => {
      const { traces, service } = setup({ "tenant-a": [{ summaries: [summary] }] });
      traces.compileLangWatchQLTraceFilter.mockReturnValueOnce({ kind: "empty" });

      await expect(service.pull({ fromMs: 1_000, toMs: 2_000 })).rejects.toThrow(/did not compile/);
      expect(traces.listTraceSummaries).not.toHaveBeenCalled();
    });
  });
});
