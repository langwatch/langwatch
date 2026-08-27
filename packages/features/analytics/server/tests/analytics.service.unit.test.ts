import { describe, expect, it, vi } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { addDays, differenceInCalendarDays } from "date-fns";
import type {
  AnalyticsEvaluationRow,
  AnalyticsTimeseriesInput,
  AnalyticsTimeseriesResult,
} from "@langwatch/analytics-contract";
import { AnalyticsService } from "../src/services/analytics.service";
import { AnalyticsAdapter } from "../src";
import { NullAnalyticsEvaluationRepository } from "../src/testing";
import {
  AnalyticsRepository,
  type AnalyticsTimeseriesQuery,
} from "../src/repositories/analytics.repository";

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

  async runTimeseries(query: AnalyticsTimeseriesQuery): Promise<AnalyticsTimeseriesResult> {
    this.lastQuery = query;
    return result;
  }

  async findFeedbackEvents(input: unknown) {
    this.lastFeedbackInput = input;
    return { events: [] };
  }

  async findTopDocuments(input: unknown) {
    this.lastDocumentsInput = input;
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
  it("routes safe additive trace reads to the trace rollup and keeps the tenant", async () => {
    const repository = new RecordingRepository();
    const service = createService(repository);

    await service.getTimeseries(input());

    expect(repository.lastQuery?.table).toBe("trace_analytics_rollup");
    expect(repository.lastQuery?.tenantId).toBe("project-1");
    expect(repository.lastQuery?.input.timeZone).toBe("Europe/Amsterdam");
  });

  it("falls back to the legacy table for a trace-id scoped query", async () => {
    const repository = new RecordingRepository();
    const service = createService(repository);

    await service.getTimeseries(input({ traceIds: ["trace-1"] }));

    expect(repository.lastQuery?.table).toBe("trace_summaries");
  });

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

    expect(repository.lastQuery?.previousPeriodStartDate).toEqual(
      new Date("2026-01-07T12:00:00.000Z"),
    );
    expect(repository.lastQuery?.maxResultRows).toBe(250);
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
    expect(repository.lastQuery?.previousPeriodStartDate).toEqual(
      addDays(startDate, -Math.max(1, calendarDays)),
    );
  });

  it("validates and decodes ClickHouse JSONEachRow results", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const service = AnalyticsAdapter.create({
      clickhouseEnabled: true,
      resolveClient: async () =>
        ({
          query: async (options: Record<string, unknown>) => {
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
        }) as unknown as ClickHouseClient,
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

  it("preserves legacy feedback decoding and document ordering", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const service = AnalyticsAdapter.create({
      clickhouseEnabled: true,
      resolveClient: async () =>
        ({
          query: async (options: Record<string, unknown>) => {
            calls.push(options);
            const query = String(options.query ?? "");
            return {
              json: async () =>
                query.includes("uniq(toString(context.document_id))")
                  ? [{ total: "7" }]
                  : query.includes("document_refs")
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
                      ],
            };
          },
        }) as unknown as ClickHouseClient,
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
      service.tryGetEvaluationAnalytics({
        tenantId: evaluationRow.tenantId,
        evaluationId: evaluationRow.evaluationId,
      }),
    ).resolves.toBeNull();
    expect(resolveClient).not.toHaveBeenCalled();
  });
});
