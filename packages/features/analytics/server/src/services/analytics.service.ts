import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { addDays, differenceInCalendarDays } from "@langwatch/time";
import {
  analyticsEvaluationReadInputSchema,
  analyticsEvaluationRollupAppendBatchInputSchema,
  analyticsEvaluationRollupAppendInputSchema,
  analyticsEvaluationUpsertBatchInputSchema,
  analyticsEvaluationUpsertInputSchema,
  analyticsTimeseriesInputSchema,
  analyticsTimeseriesResultSchema,
  analyticsReadInputSchema,
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
import { AnalyticsRepository } from "../repositories/analytics.repository.ts";
import { AnalyticsEvaluationRepository } from "../repositories/analytics-persistence.repository.ts";

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

export class AnalyticsService extends AnalyticsServiceContract {
  static create(options: {
    repository: AnalyticsRepository;
    evaluationRepository: AnalyticsEvaluationRepository;
    tripwire?: AnalyticsTripwire;
  }): AnalyticsService {
    return new AnalyticsService(options.repository, options.evaluationRepository, options.tripwire);
  }

  private constructor(
    private readonly repository: AnalyticsRepository,
    private readonly evaluationRepository: AnalyticsEvaluationRepository,
    private readonly tripwire?: AnalyticsTripwire,
    private readonly cache = new Map<string, CacheEntry>(),
  ) {
    super();
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
        const cacheKey = JSON.stringify({ input: parsed, options: options ?? null });
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          return cached.result;
        }

        this.cache.delete(cacheKey);
        const result = await this.readTimeseries(parsed, options);
        this.cache.set(cacheKey, {
          result,
          expiresAt: Date.now() + TIMESERIES_CACHE_TTL_MS,
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
      return analyticsTimeseriesResultSchema.parse(await this.repository.runTimeseries(query));
    }

    const legacyTable = parsed.series[0]?.metric.startsWith("evaluations.")
      ? "evaluation_runs"
      : "trace_summaries";
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

    return analyticsTimeseriesResultSchema.parse(result);
  }

  async getFeedbacks(input: AnalyticsReadInput): Promise<AnalyticsFeedbacksResult> {
    const parsed = analyticsReadInputSchema.parse(input);
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
    const parsed = analyticsReadInputSchema.parse(input);
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
    await this.evaluationRepository.upsert(analyticsEvaluationUpsertInputSchema.parse(input));
  }

  async upsertEvaluationAnalyticsBatch(input: AnalyticsEvaluationUpsertInput[]): Promise<void> {
    await this.evaluationRepository.upsertBatch(
      analyticsEvaluationUpsertBatchInputSchema.parse(input),
    );
  }

  tryGetEvaluationAnalytics(
    input: AnalyticsEvaluationReadInput,
  ): Promise<{ row: AnalyticsEvaluationRow; appliedEventIds: string[] } | null> {
    return this.evaluationRepository.tryFind(analyticsEvaluationReadInputSchema.parse(input));
  }

  async appendEvaluationAnalyticsRollup(
    input: AnalyticsEvaluationRollupAppendInput,
  ): Promise<void> {
    await this.evaluationRepository.appendRollup(
      analyticsEvaluationRollupAppendInputSchema.parse(input),
    );
  }

  async appendEvaluationAnalyticsRollupBatch(
    input: AnalyticsEvaluationRollupAppendBatchInput,
  ): Promise<void> {
    await this.evaluationRepository.appendRollupBatch(
      analyticsEvaluationRollupAppendBatchInputSchema.parse(input),
    );
  }
}
