import { createHash } from "node:crypto";

import {
  analyticsFeedbacksPageParamsSchema,
  analyticsTimeseriesInputSchema,
  ANALYTICS_FEEDBACKS_PAGE_DEFAULT_LIMIT,
  type AnalyticsFeedbacksCursor,
  type AnalyticsFeedbacksPageParams,
  type AnalyticsFeedbacksPageResult,
  type AnalyticsFeedbacksResult,
  type AnalyticsReadInput,
  type CostReadOptions,
  type AnalyticsTopDocumentsResult,
  type AnalyticsTimeseriesInput,
  type AnalyticsTimeseriesReadOptions,
  type AnalyticsTimeseriesResult,
  type AnalyticsEvaluationReadInput,
  type AnalyticsEvaluationRow,
  type AnalyticsEvaluationRollupAppendBatchInput,
  type AnalyticsEvaluationRollupAppendInput,
  type AnalyticsEvaluationUpsertInput,
} from "@langwatch/analytics-contract";
import {
  type Authorization,
  internalActor,
  projectIdsReadBy,
  readScopeKeyOf,
  usableAuthorization,
} from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import { ValidationError } from "@langwatch/handled-error";
import type { TenantStatementLimiter } from "@langwatch/limiter";
import { nowInstant } from "@langwatch/time";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { z } from "zod";

import type { AnalyticsEvaluationRepository } from "../repositories/analytics-persistence.repository.ts";
import type {
  AnalyticsRepository,
  AnalyticsTimeseriesQuery,
} from "../repositories/analytics.repository.ts";
import { AnalyticsTenantQueueService } from "./analytics-tenant-queue.service.ts";
import { AnalyticsTimeseriesRequestService } from "./analytics-timeseries-request.service.ts";
import type { LoggingAnalyticsTripwireService } from "./analytics-tripwire.service.ts";
import { LWQL_TENANT_CAPABILITY_MAX_PROJECTS } from "./langwatch-ql-capability.service.ts";

const TIMESERIES_CACHE_TTL_MS = 30_000;
const TIMESERIES_READ_CODE_PATH = "analytics.AnalyticsService.getTimeseries";

type CacheEntry = {
  readonly expiresAt: number;
  readonly result: AnalyticsTimeseriesResult;
};

function sortedObjectKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).toSorted(([a], [b]) => a.localeCompare(b)));
}

/**
 * What a feedbacks cursor is tied to: the project and the filters that pick the rows. The
 * window is left out, so a "last 7 days" page request that moved its end still continues.
 */
function feedbacksCursorScope(input: AnalyticsReadInput): string {
  return createHash("sha256")
    .update(JSON.stringify([input.projectId, input.filters ?? {}], sortedObjectKeys))
    .digest("hex");
}

function refuseInvalidFeedbacksPage(error: z.ZodError): never {
  throw new ValidationError("Invalid feedbacks page request", {
    meta: { fieldErrors: z.flattenError(error).fieldErrors },
  });
}

function refuseForeignFeedbacksCursor(): never {
  throw new ValidationError("This cursor belongs to a different project or filter set", {
    meta: { fieldErrors: { cursor: ["Start again from the first page."] } },
  });
}

type AnalyticsServiceDeps = {
  repository: AnalyticsRepository;
  evaluationRepository: AnalyticsEvaluationRepository;
  tenantLimiter: TenantStatementLimiter;
  /** Mints the own-project proof a series asked without one reads under. */
  authz: Pick<AuthzApi, "authorizeInternal">;
  tripwire?: LoggingAnalyticsTripwireService;
  /** The most members one aggregate read may span; LangWatchQL's cap when unset. */
  maxMembers?: number | undefined;
};

/** A cost-gated read's proof, refused when forged or expired before any read. */
function costProof({ authorization }: CostReadOptions): Authorization {
  return usableAuthorization({ authorization, now: nowInstant().epochMilliseconds });
}

export class AnalyticsService {
  static create(options: AnalyticsServiceDeps): AnalyticsService {
    return new AnalyticsService(options);
  }

  private readonly repository: AnalyticsRepository;
  private readonly evaluationRepository: AnalyticsEvaluationRepository;
  private readonly tenantQueue: AnalyticsTenantQueueService;
  private readonly timeseriesRequest = AnalyticsTimeseriesRequestService.create();
  private readonly authz: Pick<AuthzApi, "authorizeInternal">;
  private readonly tripwire?: LoggingAnalyticsTripwireService;
  private readonly cache = new Map<string, CacheEntry>();

  private constructor(deps: AnalyticsServiceDeps) {
    this.repository = deps.repository;
    this.evaluationRepository = deps.evaluationRepository;
    this.tenantQueue = AnalyticsTenantQueueService.create({
      tenantLimiter: deps.tenantLimiter,
      maxMembers: deps.maxMembers ?? LWQL_TENANT_CAPABILITY_MAX_PROJECTS,
    });
    this.authz = deps.authz;
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
        this.timeseriesRequest.refuseDisallowedAggregations(parsed);
        // Checked before the cache, so an expired or forged proof is refused even on a repeat.
        const authorization = usableAuthorization({
          authorization:
            options?.authorization ?? (await this.ownProof({ projectId: parsed.projectId })),
          now: nowInstant().epochMilliseconds,
        });
        // Keyed on who the proof fences, not the proof: each request mints a fresh one, and two
        // callers on one aggregate with different grants must not share an answer.
        const cacheKey = JSON.stringify({
          input: parsed,
          maxResultRows: options?.maxResultRows ?? null,
          scope: readScopeKeyOf(authorization, "analytics:view"),
        });
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expiresAt > nowInstant().epochMilliseconds) {
          return cached.result;
        }

        this.cache.delete(cacheKey);
        const result = await this.readTimeseries(parsed, {
          authorization,
          maxResultRows: options?.maxResultRows,
        });
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

  /** A series asked without a proof reads its own project as the platform, never a member. */
  private ownProof({ projectId }: { projectId: string }): Promise<Authorization> {
    return this.authz.authorizeInternal({
      actor: internalActor(TIMESERIES_READ_CODE_PATH),
      projectId,
      permission: "analytics:view",
      purpose: { kind: "operator", entry: TIMESERIES_READ_CODE_PATH },
    });
  }

  private async readTimeseries(
    parsed: AnalyticsTimeseriesInput,
    options: { authorization: Authorization; maxResultRows: number | undefined },
  ): Promise<AnalyticsTimeseriesResult> {
    const { input: routedInput, ...window } = this.timeseriesRequest.windowOf(parsed);
    // The tripwire is asked of one project's reads; a proof spanning members is left out of it.
    const readsOneProject = projectIdsReadBy(options.authorization, "analytics:view").length === 1;
    const table = this.repository.tableFor(routedInput, { readsMembers: !readsOneProject });
    const query = {
      table,
      authorization: options.authorization,
      input: routedInput,
      ...window,
      maxResultRows: options.maxResultRows,
    };
    if (
      table === "trace_summaries" ||
      table === "evaluation_runs" ||
      !readsOneProject ||
      !(await this.tripwire?.isEnabled(parsed.projectId))
    ) {
      return this.limitedTimeseries(query);
    }

    const isEvaluationSeries = Boolean(parsed.series[0]?.metric.startsWith("evaluations."));
    const legacyTable = isEvaluationSeries ? "evaluation_runs" : "trace_summaries";
    const [result, legacy] = await Promise.all([
      this.limitedTimeseries(query),
      this.limitedTimeseries({ ...query, table: legacyTable }),
    ]);
    this.tripwire?.compare({
      projectId: parsed.projectId,
      table,
      routed: result,
      legacy,
    });

    return result;
  }

  /** A dashboard queues its panels behind its tenants' shares rather than running them at once. */
  private limitedTimeseries(query: AnalyticsTimeseriesQuery): Promise<AnalyticsTimeseriesResult> {
    return this.tenantQueue.run({
      authorization: query.authorization,
      permission: "analytics:view",
      projectId: query.input.projectId,
      task: () => this.repository.runTimeseries(query),
    });
  }

  async getFeedbacks(
    input: AnalyticsReadInput,
    options: CostReadOptions,
  ): Promise<AnalyticsFeedbacksResult> {
    const parsed = {
      authorization: costProof(options),
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

  async getFeedbacksPage(
    input: AnalyticsReadInput & AnalyticsFeedbacksPageParams,
    options: CostReadOptions,
  ): Promise<AnalyticsFeedbacksPageResult> {
    const authorization = costProof(options);
    const page = analyticsFeedbacksPageParamsSchema.safeParse({
      cursor: input.cursor,
      limit: input.limit,
    });
    if (!page.success) refuseInvalidFeedbacksPage(page.error);
    const scope = feedbacksCursorScope(input);
    if (page.data.cursor && page.data.cursor.scope !== scope) refuseForeignFeedbacksCursor();
    const limit = page.data.limit ?? ANALYTICS_FEEDBACKS_PAGE_DEFAULT_LIMIT;

    const span = this.tracer.startSpan("AnalyticsService.getFeedbacksPage", {
      attributes: { "tenant.id": input.projectId },
    });
    const activeContext = trace.setSpan(context.active(), span);

    return context.with(activeContext, async (): Promise<AnalyticsFeedbacksPageResult> => {
      try {
        const read = await this.repository.findFeedbackEventsPage({
          authorization,
          projectId: input.projectId,
          startDate: input.startDate,
          endDate: input.endDate,
          filters: input.filters,
          after: page.data.cursor?.after,
          limit,
        });
        span.setAttribute("event.count", read.rows.length);
        const events = read.rows.map((row) => row.event);
        const last = read.rows.at(-1);
        if (!read.hasMore || !last) return { hasMore: false, events };
        const nextCursor: AnalyticsFeedbacksCursor = { scope, after: last.position };
        return { hasMore: true, events, nextCursor };
      } catch (error) {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({ code: SpanStatusCode.ERROR });

        throw error;
      } finally {
        span.end();
      }
    });
  }

  async getTopUsedDocuments(
    input: AnalyticsReadInput,
    options: CostReadOptions,
  ): Promise<AnalyticsTopDocumentsResult> {
    const parsed = {
      authorization: costProof(options),
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
        const result = await this.tenantQueue.run({
          authorization: parsed.authorization,
          permission: "cost:view",
          projectId: parsed.projectId,
          task: () => this.repository.findTopDocuments(parsed),
        });
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

  async findEvaluationAnalytics(
    input: AnalyticsEvaluationReadInput,
  ): Promise<{ row: AnalyticsEvaluationRow; appliedEventIds: string[] } | null> {
    const [latest] = await this.evaluationRepository.findLatest(input);
    return latest ?? null;
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
