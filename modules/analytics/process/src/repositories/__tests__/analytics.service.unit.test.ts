import type { ClickHouseClient } from "@clickhouse/client";
import type {
  AnalyticsEvaluationRow,
  AnalyticsTable,
  AnalyticsTimeseriesInput,
  AnalyticsTimeseriesResult,
  SharedFiltersInput,
} from "@langwatch/analytics-contract";
import { clickHouseClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { addDays, differenceInCalendarDays, Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { AnalyticsAdapter } from "../../index.ts";
import { AnalyticsService } from "../../services/analytics.service.ts";
import { NullAnalyticsEvaluationRepository } from "../analytics-persistence.repository.ts";
import { AnalyticsRepository, type AnalyticsTimeseriesQuery } from "../analytics.repository.ts";
import { pickAnalyticsTable } from "../clickhouse/clickhouse.analytics-route-table.mapper.ts";

const input = (overrides: Partial<AnalyticsTimeseriesInput> = {}): AnalyticsTimeseriesInput => ({
  projectId: "project-1",
  startDate: Date.UTC(2026, 0, 1),
  endDate: Date.UTC(2026, 0, 2),
  filters: {},
  series: [{ metric: "performance.total_cost", aggregation: "sum" }],
  timeZone: "Europe/Amsterdam",
  ...overrides,
});

const result: AnalyticsTimeseriesResult = {
  previousPeriod: [],
  currentPeriod: [{ date: "2026-01-01", "0/performance.total_cost/sum": 1 }],
};

const evaluationRow: AnalyticsEvaluationRow = {
  tenantId: "project-1",
  evaluationId: "evaluation-1",
  version: "2026-08-27",
  occurredAtMs: 1_756_262_400_000,
  createdAtMs: 1_756_262_400_000,
  updatedAtMs: 1_756_262_400_000,
  evaluatorType: "native",
  evaluatorName: null,
  status: "processed",
  isGuardrail: false,
  passed: true,
  score: 1,
  label: null,
  model: null,
  traceId: null,
  userId: null,
  conversationId: null,
  customerId: null,
  origin: null,
  durationMs: 1,
  totalCost: null,
  nonBilledCost: null,
  attributes: {},
  startedAtMs: null,
  completedAtMs: null,
};

class RecordingRepository extends AnalyticsRepository {
  lastQuery: AnalyticsTimeseriesQuery | undefined;
  lastFeedbackInput: unknown;
  lastDocumentsInput: unknown;

  // The real routing, because what these cases claim is which table a read is
  // sent to — a double that answered a fixed table would assert itself.
  tableFor(timeseriesInput: AnalyticsTimeseriesInput): AnalyticsTable {
    return pickAnalyticsTable(timeseriesInput);
  }

  async runTimeseries(query: AnalyticsTimeseriesQuery): Promise<AnalyticsTimeseriesResult> {
    this.lastQuery = query;
    return result;
  }

  async findFeedbackEvents(feedbackInput: unknown) {
    this.lastFeedbackInput = feedbackInput;
    return { events: [] };
  }

  async findTopDocuments(documentsInput: unknown) {
    this.lastDocumentsInput = documentsInput;
    return { topDocuments: [], totalUniqueDocuments: 0 };
  }
}

function createService(repository: AnalyticsRepository): AnalyticsService {
  return AnalyticsService.create({
    repository,
    evaluationRepository: NullAnalyticsEvaluationRepository.create(),
  });
}

describe("AnalyticsService", () => {
  /** @scenario "Additive trace metrics use the trace rollup" */
  it("routes safe additive trace reads to the trace rollup and keeps the tenant", async () => {
    const repository = new RecordingRepository();
    const service = createService(repository);

    await service.getTimeseries(input());

    expect(repository.lastQuery?.table).toBe("trace_analytics_rollup");
    expect(repository.lastQuery?.tenantId).toBe("project-1");
    expect(repository.lastQuery?.input.timeZone).toBe("Europe/Amsterdam");
  });

  /** @scenario "Unsafe query shapes use the legacy trace table" */
  it("falls back to the legacy table for a trace-id scoped query", async () => {
    const repository = new RecordingRepository();
    const service = createService(repository);

    await service.getTimeseries(input({ traceIds: ["trace-1"] }));

    expect(repository.lastQuery?.table).toBe("trace_summaries");
  });

  /** @scenario "Oversized requests are bounded" */
  it("normalizes an oversized bucket request to the daily safety cap", async () => {
    const repository = new RecordingRepository();
    const service = createService(repository);

    await service.getTimeseries(
      input({
        startDate: Date.UTC(2020, 0, 1),
        endDate: Date.UTC(2020, 0, 10),
        timeScale: 1,
      }),
    );

    expect(repository.lastQuery?.adjustedTimeScale).toBe(24 * 60);
  });

  it("keeps the legacy calendar-day previous-period envelope and row ceiling", async () => {
    const repository = new RecordingRepository();
    const service = createService(repository);
    const startDate = new Date("2026-01-10T12:00:00.000Z");
    const endDate = new Date("2026-01-12T01:00:00.000Z");

    await service.getTimeseries(
      input({
        startDate: startDate.getTime(),
        endDate: endDate.getTime(),
        timeScale: 60,
      }),
      { maxResultRows: 250 },
    );

    expect(repository.lastQuery?.previousPeriodStartDate.epochMilliseconds).toBe(
      Temporal.Instant.from("2026-01-07T12:00:00.000Z").epochMilliseconds,
    );
    expect(repository.lastQuery?.maxResultRows).toBe(250);
  });

  /** @scenario "A comparison window is always a whole number of days" */
  it("reads a window handed over end first without failing on a fractional day", async () => {
    const repository = new RecordingRepository();
    const service = createService(repository);
    const startDate = new Date("2026-01-12T00:00:00.000Z");
    const endDate = new Date("2026-01-10T00:00:00.000Z");

    await service.getTimeseries(
      input({ startDate: startDate.getTime(), endDate: endDate.getTime(), timeScale: 60 }),
    );

    expect(repository.lastQuery?.previousPeriodStartDate.epochMilliseconds).toBe(
      Temporal.Instant.from("2026-01-11T00:00:00.000Z").epochMilliseconds,
    );
  });

  it("uses the legacy local-calendar date calculation around a UTC date boundary", async () => {
    const repository = new RecordingRepository();
    const service = createService(repository);
    const startDate = new Date("2026-01-10T23:30:00.000Z");
    const endDate = new Date("2026-01-11T00:30:00.000Z");

    await service.getTimeseries(
      input({ startDate: startDate.getTime(), endDate: endDate.getTime() }),
    );

    const calendarDays = differenceInCalendarDays(endDate, startDate) + 1;
    expect(repository.lastQuery?.previousPeriodStartDate.epochMilliseconds).toBe(
      addDays(startDate, -Math.max(1, calendarDays)).getTime(),
    );
  });

  it("validates and decodes ClickHouse JSONEachRow results", async () => {
    const calls: Parameters<ClickHouseClient["query"]>[0][] = [];
    const service = AnalyticsAdapter.create({
      clickhouseEnabled: true,
      resolveClient: async () =>
        clickHouseClientDouble({
          query: async (options) => {
            calls.push(options);
            return {
              json: async () => [
                {
                  period: "current",
                  date: "2026-01-01",
                  "0__performance_total_cost__sum": "2.5",
                },
              ],
            };
          },
        }),
    });

    await expect(service.getTimeseries(input())).resolves.toEqual({
      previousPeriod: [],
      currentPeriod: [{ date: "2026-01-01", "0/performance.total_cost/sum": 2.5 }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.clickhouse_settings).toMatchObject({
      max_bytes_before_external_group_by: 500_000_000,
    });
  });

  /** @scenario "Feedback reads preserve their existing result shape" */
  /** @scenario "Top-document reads preserve their existing result shape" */
  it("keeps feedback and document reads on the canonical service boundary", async () => {
    const repository = new RecordingRepository();
    const service = createService(repository);
    const filters = { "metadata.user_id": ["user-1"] };

    await expect(
      service.getFeedbacks({
        projectId: "project-1",
        startDate: 10,
        endDate: 20,
        filters,
      }),
    ).resolves.toEqual({ events: [] });
    await expect(
      service.getTopUsedDocuments({
        projectId: "project-1",
        startDate: 10,
        endDate: 20,
        filters,
      }),
    ).resolves.toEqual({ topDocuments: [], totalUniqueDocuments: 0 });
    expect(repository.lastFeedbackInput).toEqual({
      projectId: "project-1",
      startDate: 10,
      endDate: 20,
      filters,
    });
    expect(repository.lastDocumentsInput).toEqual({
      projectId: "project-1",
      startDate: 10,
      endDate: 20,
      filters,
    });
  });

  /** @scenario "Feedback and top-document reads ignore the toolbar's search and negation" */
  it("reads feedbacks and top documents when the toolbar sends a search and negation", async () => {
    const repository = new RecordingRepository();
    const service = createService(repository);
    const toolbarRead: SharedFiltersInput = {
      projectId: "project-1",
      startDate: 10,
      endDate: 20,
      filters: {},
      query: "refund",
      negateFilters: true,
    };
    const expected = { projectId: "project-1", startDate: 10, endDate: 20, filters: {} };

    await expect(service.getFeedbacks(toolbarRead)).resolves.toEqual({ events: [] });
    await expect(service.getTopUsedDocuments(toolbarRead)).resolves.toEqual({
      topDocuments: [],
      totalUniqueDocuments: 0,
    });
    expect(repository.lastFeedbackInput).toEqual(expected);
    expect(repository.lastDocumentsInput).toEqual(expected);
  });

  /** @scenario "Feedback reads preserve their existing result shape" */
  /** @scenario "Top-document reads preserve their existing result shape" */
  it("preserves legacy feedback decoding and document ordering", async () => {
    const calls: Parameters<ClickHouseClient["query"]>[0][] = [];
    const service = AnalyticsAdapter.create({
      clickhouseEnabled: true,
      resolveClient: async () =>
        clickHouseClientDouble({
          query: async (options) => {
            calls.push(options);
            const query = typeof options.query === "string" ? options.query : "";
            const documentRows = query.includes("document_refs")
              ? [
                  {
                    documentId: "doc-1",
                    count: "3",
                    traceId: "trace-1",
                    content: "hello",
                  },
                ]
              : [
                  {
                    trace_id: "trace-1",
                    event_id: "event-1",
                    started_at: "1700000000123",
                    event_type: "thumbs_up_down",
                    attributes: {
                      "event.metrics.vote": "1",
                      reason: "helpful",
                    },
                  },
                ];
            const isDocumentTotal = query.includes("uniq(toString(context.document_id))");

            return {
              json: async () => (isDocumentTotal ? [{ total: "7" }] : documentRows),
            };
          },
        }),
    });

    await expect(
      service.getFeedbacks({
        projectId: "project-1",
        startDate: 10,
        endDate: 20,
        filters: {},
      }),
    ).resolves.toEqual({
      events: [
        {
          event_id: "event-1",
          event_type: "thumbs_up_down",
          project_id: "project-1",
          trace_id: "trace-1",
          timestamps: {
            started_at: 1700000000123,
            inserted_at: 1700000000123,
            updated_at: 1700000000123,
          },
          metrics: [{ key: "vote", value: 1 }],
          event_details: [{ key: "reason", value: "helpful" }],
        },
      ],
    });
    await expect(
      service.getTopUsedDocuments({
        projectId: "project-1",
        startDate: 10,
        endDate: 20,
        filters: {},
      }),
    ).resolves.toEqual({
      topDocuments: [{ documentId: "doc-1", count: 3, traceId: "trace-1", content: "hello" }],
      totalUniqueDocuments: 7,
    });
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.clickhouse_settings).toMatchObject({
        max_bytes_before_external_group_by: 500_000_000,
      });
    }
  });

  /** @scenario "ClickHouse-disabled processes preserve evaluation projection no-ops" */
  it("keeps evaluation analytics writes and read-backs as no-ops when ClickHouse is disabled", async () => {
    const resolveClient = vi.fn(async () => {
      throw new Error("ClickHouse must not be resolved when disabled");
    });
    const service = AnalyticsAdapter.create({
      resolveClient,
      clickhouseEnabled: false,
    });

    await service.upsertEvaluationAnalytics({ row: evaluationRow });
    await service.appendEvaluationAnalyticsRollup({
      row: {
        tenantId: evaluationRow.tenantId,
        bucketStart: new Date(evaluationRow.occurredAtMs),
        evaluatorType: evaluationRow.evaluatorType,
        status: evaluationRow.status,
        evalCount: 1,
        passCount: 1,
        failCount: 0,
        errorCount: 0,
        skippedCount: 0,
        scoreSum: 1,
        scoreCount: 1,
        durationSum: 1,
        costSum: 0,
        nonBilledCostSum: 0,
      },
    });

    await expect(
      service.findEvaluationAnalytics({
        tenantId: evaluationRow.tenantId,
        evaluationId: evaluationRow.evaluationId,
      }),
    ).resolves.toBeNull();
    expect(resolveClient).not.toHaveBeenCalled();
  });

  describe("given a series its metric cannot aggregate", () => {
    /** @scenario "A series with an aggregation its metric does not support is refused" */
    it("refuses a sum over evaluation runs before reading", async () => {
      const repository = new RecordingRepository();
      const service = createService(repository);

      const refusal = service.getTimeseries(
        input({ series: [{ metric: "evaluations.evaluation_runs", aggregation: "sum" }] }),
      );

      await expect(refusal).rejects.toMatchObject({
        code: "validation_error",
        meta: {
          metric: "evaluations.evaluation_runs",
          aggregation: "sum",
          allowedAggregations: ["cardinality"],
          fieldErrors: { "series.0.aggregation": expect.any(Array) },
        },
      });
      expect(repository.lastQuery).toBeUndefined();
    });

    /** @scenario "A series naming a metric outside the analytics registry is refused" */
    it("refuses a metric the registry does not define before reading", async () => {
      const repository = new RecordingRepository();
      const service = createService(repository);

      const refusal = service.getTimeseries(
        input({
          series: [
            { metric: "performance.total_cost", aggregation: "sum" },
            { metric: "spans.metrics.prompt_tokens", aggregation: "sum" },
          ],
        }),
      );

      await expect(refusal).rejects.toMatchObject({
        code: "validation_error",
        meta: { fieldErrors: { "series.1.metric": expect.any(Array) } },
      });
      expect(repository.lastQuery).toBeUndefined();
    });
  });
});
