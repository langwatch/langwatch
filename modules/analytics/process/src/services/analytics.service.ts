import {
  analyticsMetricAggregations,
  analyticsTimeseriesInputSchema,
  AnalyticsService as AnalyticsServiceContract,
  type AnalyticsFeedbacksResult,
  type AnalyticsReadInput,
  type AnalyticsTopDocumentsResult,
  type AnalyticsTripwire,
  type AnalyticsTimeseriesInput,
  type AnalyticsTimeseriesReadOptions,
  type AnalyticsTimeseriesResult,
  type AnalyticsEvaluationReadInput,
  type AnalyticsEvaluationRow,
  type AnalyticsEvaluationRollupAppendBatchInput,
  type AnalyticsEvaluationRollupAppendInput,
  type AnalyticsEvaluationUpsertInput,
} from "@langwatch/analytics-contract";
import { ValidationError } from "@langwatch/handled-error";
import { addDays, differenceInCalendarDays, nowInstant } from "@langwatch/time";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";

import type { AnalyticsEvaluationRepository } from "../repositories/analytics-persistence.repository.ts";
import type { AnalyticsRepository } from "../repositories/analytics.repository.ts";

const MINUTES_PER_DAY = 24 * 60;
const MAX_TIMESERIES_BUCKETS = 1000;
const MS_PER_MINUTE = 60_000;
const TIMESERIES_CACHE_TTL_MS = 30_000;

type CacheEntry = {
  readonly expiresAt: number;
  readonly result: AnalyticsTimeseriesResult;
};

function currentAndPreviousDates(
  startDate: Date,
  endDate: Date,
  period?: number,
): {
  readonly startDate: Date;
  readonly endDate: Date;
  readonly previousPeriodStartDate: Date;
} {
  // Whole days, always: the scale arrives in minutes and a sub-day scale is a
  // fraction of one, which Temporal refuses outright rather than truncating the
  // way the retired library did.
  const periodInDays = period === undefined ? 1 : Math.ceil(period / MINUTES_PER_DAY);
  const days = Math.max(periodInDays, differenceInCalendarDays(endDate, startDate) + 1);
  const previousPeriodStartDate = addDays(startDate, -days);

  return { startDate, endDate, previousPeriodStartDate };
}

/**
 * "full" is one bucket for the whole range and passes through; only a numeric
 * scale that would produce more than the cap collapses to daily.
 */
function adjustTimeScaleForBucketCap({
  timeScale,
  startDate,
  endDate,
}: {
  timeScale: number | "full" | undefined;
  startDate: Date;
  endDate: Date;
}): number | "full" {
  if (timeScale === undefined) {
    return MINUTES_PER_DAY;
  }

  if (timeScale === "full") {
    return timeScale;
  }

  const estimatedBuckets = (endDate.getTime() - startDate.getTime()) / MS_PER_MINUTE / timeScale;

  return estimatedBuckets > MAX_TIMESERIES_BUCKETS ? MINUTES_PER_DAY : timeScale;
}

/** Refused before any cache or repository read; ClickHouse would crash on the SQL (#8009). */
function refuseDisallowedSeriesAggregations(input: AnalyticsTimeseriesInput): void {
  for (const [index, series] of input.series.entries()) {
    const allowedAggregations = analyticsMetricAggregations[series.metric];
    if (!allowedAggregations) {
      throw new ValidationError("Unknown analytics metric", {
        meta: {
          fieldErrors: {
            [`series.${index}.metric`]: [
              "This metric is not one of the supported analytics metrics.",
            ],
          },
        },
      });
    }
    if (!allowedAggregations.includes(series.aggregation)) {
      throw new ValidationError(
        `Metric "${series.metric}" does not support aggregation "${series.aggregation}" ` +
          `(allowed: ${allowedAggregations.join(", ")})`,
        {
          meta: {
            metric: series.metric,
            aggregation: series.aggregation,
            allowedAggregations,
            fieldErrors: {
              [`series.${index}.aggregation`]: ["This metric does not support this aggregation."],
            },
          },
        },
      );
    }
  }
}

export class AnalyticsService extends AnalyticsServiceContract {
  static create(options: {
    repository: AnalyticsRepository;
    evaluationRepository: AnalyticsEvaluationRepository;
    tripwire?: AnalyticsTripwire;
  }): AnalyticsService {
    return new AnalyticsService(options);
  }

  private readonly repository: AnalyticsRepository;
  private readonly evaluationRepository: AnalyticsEvaluationRepository;
  private readonly tripwire?: AnalyticsTripwire;
  private readonly cache = new Map<string, CacheEntry>();

  private constructor(deps: {
    repository: AnalyticsRepository;
    evaluationRepository: AnalyticsEvaluationRepository;
    tripwire?: AnalyticsTripwire;
  }) {
    super();
    this.repository = deps.repository;
    this.evaluationRepository = deps.evaluationRepository;
    this.tripwire = deps.tripwire;
  }

  private readonly tracer = trace.getTracer("langwatch.analytics.service");

  async getTimeseries(
    input: AnalyticsTimeseriesInput,
    options?: AnalyticsTimeseriesReadOptions,
  ): Promise<AnalyticsTimeseriesResult> {
    const span = this.tracer.startSpan("AnalyticsService.getTimeseries", {
      attributes: { "tenant.id": input.projectId },
    });
    const activeContext = trace.setSpan(context.active(), span);

    return context.with(activeContext, async () => {
      try {
        const parsed = analyticsTimeseriesInputSchema.parse(input);
        refuseDisallowedSeriesAggregations(parsed);
        const cacheKey = JSON.stringify({ input: parsed, options: options ?? null });
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expiresAt > nowInstant().epochMilliseconds) {
          return cached.result;
        }

        this.cache.delete(cacheKey);
        const result = await this.readTimeseries(parsed, options);
        this.cache.set(cacheKey, {
          result,
          expiresAt: nowInstant().epochMilliseconds + TIMESERIES_CACHE_TTL_MS,
        });

        return result;
      } catch (error) {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({ code: SpanStatusCode.ERROR });

        throw error;
      } finally {
        span.end();
      }
    });
  }

  private async readTimeseries(
    parsed: AnalyticsTimeseriesInput,
    options?: AnalyticsTimeseriesReadOptions,
  ): Promise<AnalyticsTimeseriesResult> {
    const startDate = new Date(parsed.startDate);
    const endDate = new Date(parsed.endDate);
    const { previousPeriodStartDate } = currentAndPreviousDates(
      startDate,
      endDate,
      typeof parsed.timeScale === "number" ? parsed.timeScale : undefined,
    );
    const adjustedTimeScale = adjustTimeScaleForBucketCap({
      timeScale: parsed.timeScale,
      startDate,
      endDate,
    });
    const table = this.repository.tableFor(parsed);
    const query = {
      table,
      tenantId: parsed.projectId,
      input: parsed,
      startDate,
      endDate,
      previousPeriodStartDate,
      adjustedTimeScale,
      maxResultRows: options?.maxResultRows,
    };
    if (
      table === "trace_summaries" ||
      table === "evaluation_runs" ||
      !(await this.tripwire?.isEnabled(parsed.projectId))
    ) {
      return this.repository.runTimeseries(query);
    }

    const isEvaluationSeries = Boolean(parsed.series[0]?.metric.startsWith("evaluations."));
    const legacyTable = isEvaluationSeries ? "evaluation_runs" : "trace_summaries";
    const [result, legacy] = await Promise.all([
      this.repository.runTimeseries(query),
      this.repository.runTimeseries({ ...query, table: legacyTable }),
    ]);
    this.tripwire?.compare({
      projectId: parsed.projectId,
      table,
      routed: result,
      legacy,
    });

    return result;
  }

  async getFeedbacks(input: AnalyticsReadInput): Promise<AnalyticsFeedbacksResult> {
    const parsed = {
      projectId: input.projectId,
      startDate: input.startDate,
      endDate: input.endDate,
      filters: input.filters,
    };
    const span = this.tracer.startSpan("AnalyticsService.getFeedbacks", {
      attributes: { "tenant.id": parsed.projectId },
    });
    const activeContext = trace.setSpan(context.active(), span);

    return context.with(activeContext, async () => {
      try {
        const result = await this.repository.findFeedbackEvents(parsed);
        span.setAttribute("event.count", result.events.length);

        return result;
      } catch (error) {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({ code: SpanStatusCode.ERROR });

        throw error;
      } finally {
        span.end();
      }
    });
  }

  async getTopUsedDocuments(input: AnalyticsReadInput): Promise<AnalyticsTopDocumentsResult> {
    const parsed = {
      projectId: input.projectId,
      startDate: input.startDate,
      endDate: input.endDate,
      filters: input.filters,
    };
    const span = this.tracer.startSpan("AnalyticsService.getTopUsedDocuments", {
      attributes: { "tenant.id": parsed.projectId },
    });
    const activeContext = trace.setSpan(context.active(), span);

    return context.with(activeContext, async () => {
      try {
        const result = await this.repository.findTopDocuments(parsed);
        span.setAttribute("document.count", result.topDocuments.length);

        return result;
      } catch (error) {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({ code: SpanStatusCode.ERROR });

        throw error;
      } finally {
        span.end();
      }
    });
  }

  async upsertEvaluationAnalytics(input: AnalyticsEvaluationUpsertInput): Promise<void> {
    await this.evaluationRepository.upsert(input);
  }

  async upsertEvaluationAnalyticsBatch(input: AnalyticsEvaluationUpsertInput[]): Promise<void> {
    await this.evaluationRepository.upsertBatch(input);
  }

  findEvaluationAnalytics(
    input: AnalyticsEvaluationReadInput,
  ): Promise<{ row: AnalyticsEvaluationRow; appliedEventIds: string[] } | null> {
    return this.evaluationRepository.tryFind(input);
  }

  async appendEvaluationAnalyticsRollup(
    input: AnalyticsEvaluationRollupAppendInput,
  ): Promise<void> {
    await this.evaluationRepository.appendRollup(input);
  }

  async appendEvaluationAnalyticsRollupBatch(
    input: AnalyticsEvaluationRollupAppendBatchInput,
  ): Promise<void> {
    await this.evaluationRepository.appendRollupBatch(input);
  }
}
