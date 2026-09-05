/**
 * The OTLP receiver, composed from this process's own graph. Ingestion is the one path
 * where this process is a WRITER rather than a reader, and everything below follows from
 * that.
 */
import { TraceProcessingProducerAdapter } from "@langwatch/trace-server";
import {
  CodingAgentService,
  type CodingAgentSpanFilterInput,
} from "@langwatch/coding-agent-contract";
import type { EventSourcing } from "@langwatch/eventing";
import { createLogger, type Logger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";
import { PlanLimitExceededError } from "@langwatch/entitlement-contract";
import type { UsageLimitResult } from "@langwatch/entitlement-server";
import { DEFAULT_PII_REDACTION_LEVEL, type RecordSpanCommandData } from "@langwatch/trace-contract";
import {
  TraceIngestionService,
  TraceIngressCommandPort,
  TraceSpanCollectionService,
  TraceSpanDedupPort,
  TrackedEventSpanService,
  type CollectorCredential,
  type CollectorCredentialPort,
  type CollectorSpanIngestPort,
  type CollectorUsageLimitPort,
  type OtlpIngestCredential,
  type OtlpIngestRestPorts,
  type SpanDedupRef,
} from "@langwatch/trace-server";

import type { ApiHandlerManagedCredentials } from "./api-handler-managed-credential";

/** The pipeline both the annotation commands and this receiver send on. */
const TRACE_PROCESSING_PIPELINE = "trace_processing";

/**
 * The coding-agent span filter is on by default, exactly as the platform
 * application had it: its kill switch was an environment variable read at that
 * process's boot, and this process does not carry one.
 */
const CODING_AGENT_SPAN_FILTER_ENABLED = true;

/**
 * The one allowance question an ingest door asks. `UsageService.checkLimit` satisfies it.
 */
export type ApiTraceIngestAllowance = Readonly<{
  checkLimit(input: { teamId: string }): Promise<UsageLimitResult>;
}>;

/** Reports the composition decisions an absent collaborator would hide. */
export abstract class ApiTraceIngestAbsenceReport {
  abstract absent(capability: "command-queue" | "dedup" | "plan-allowance"): void;
}

export class LoggedApiTraceIngestAbsence extends ApiTraceIngestAbsenceReport {
  static create(logger: Logger): LoggedApiTraceIngestAbsence {
    return new LoggedApiTraceIngestAbsence(logger);
  }

  private constructor(private readonly logger: Logger) {
    super();
  }

  absent(capability: "command-queue" | "dedup" | "plan-allowance"): void {
    this.logger.warn(
      { capability },
      capability === "command-queue"
        ? "no command queue, so this process serves no OTLP ingestion at all"
        : capability === "dedup"
          ? "no Redis, so a span exported twice is recorded twice"
          : "no usage enforcement: this process opened no ClickHouse, so there is no rollup to count the month's volume in and an export is accepted without checking the plan's monthly allowance",
    );
  }
}

export type ApiTraceIngestOptions = Readonly<{
  /** The process's producer runtime, or none. */
  eventing: EventSourcing | undefined;
  /** The Group Queue's Redis, or none. */
  redis: RedisConnection | null | undefined;
  /** The one credential resolution both this door and the chain use. */
  credentials: ApiHandlerManagedCredentials;
  /**
   * The plan's monthly allowance, or none.
   */
  allowance?: ApiTraceIngestAllowance | undefined;
  /** Names this process in the producer registration's own refusals. */
  processName: string;
  report?: ApiTraceIngestAbsenceReport;
}>;

/**
 * Every ingest door's ports, composed over ONE dedup gate and ONE command sender.
 */
export type ApiTraceIngestComposition = Readonly<{
  /** `POST /api/otel/v1/*` and its path aliases. */
  otlp: OtlpIngestRestPorts;
  /**
   * The plan allowance the COLLECTOR door enforces — the same object `otlp.usageLimit`
   * is, published separately because the collector's ports are assembled by the root
   * rather than returned whole here.
   */
  usageLimit: CollectorUsageLimitPort;
  /** `POST /api/collector`: one already-normalized span at a time. */
  ingestSpan: CollectorSpanIngestPort;
  /**
   * The collector's own credential resolution, over the SAME
   * `ApiHandlerManagedCredentials` the OTLP door uses.
   */
  collectorCredential: CollectorCredentialPort;
  /**
   * The builder `POST /api/events/track` and `POST /api/track_event` record through: one
   * customer feedback event as the one synthetic span that carries it.
   */
  trackedEventSpans: TrackedEventSpanService;
}>;

/**
 * Both ingest doors' ports, or nothing. Nothing when there is no command queue: a
 * receiver that accepts a span and has nowhere to send it answers 200 to data it then
 * drops, which is the one failure an exporter cannot detect and cannot retry.
 */
export function composeApiTraceIngest(
  options: ApiTraceIngestOptions,
): ApiTraceIngestComposition | undefined {
  const { eventing, report } = options;
  if (!eventing) {
    report?.absent("command-queue");
    return undefined;
  }

  const logger = createLogger("langwatch:api:trace-ingest");
  const commands = ApiTraceIngressCommandAdapter.create(
    resolveRecordSpan({ eventing, processName: options.processName }),
  );
  const dedup = composeApiTraceSpanDedup({ redis: options.redis, logger, report });

  const ingestion = TraceIngestionService.create({
    codingAgents: new ApiSpanFilterOnlyCodingAgents(),
    codingAgentSpanFilterEnabled: CODING_AGENT_SPAN_FILTER_ENABLED,
    dedup,
    commands,
  });

  const usageLimit = composeApiTraceIngestUsageLimit({
    allowance: options.allowance,
    logger,
    report,
  });

  const authenticate = (request: Request) =>
    options.credentials.authenticate({ request, permission: "traces:create" });

  return {
    otlp: {
      credential: async ({ request }) => toOtlpCredential(await authenticate(request)),
      usageLimit,
      traces: ({ tenantId, traceRequest }) =>
        ingestion.handleOtlpTraceRequest(tenantId, traceRequest, DEFAULT_PII_REDACTION_LEVEL),
    },
    // The SAME gate object the receiver holds, not a second one built from the
    // same service: the two doors are one allowance, and the collector's port
    // takes only the project, which is the receiver's input minus a field it
    // never reads.
    usageLimit,
    ingestSpan: (input) => ingestion.ingestNormalizedSpan(input as never),
    collectorCredential: async ({ request }) => toCollectorCredential(await authenticate(request)),
    // A SECOND `TraceSpanCollectionService` over the SAME `dedup` and `commands` objects,
    // not a second gate: the class holds no state of its own beyond those two references,
    // so both instances claim the same Redis keys and send on the same registration.
    trackedEventSpans: TrackedEventSpanService.create({
      collection: TraceSpanCollectionService.create({ dedup, commands }),
    }),
  };
}

/**
 * The gate both ingest doors call before a byte of the batch is parsed.
 */
function composeApiTraceIngestUsageLimit(options: {
  allowance: ApiTraceIngestAllowance | undefined;
  logger: Logger;
  report: ApiTraceIngestAbsenceReport | undefined;
}): CollectorUsageLimitPort {
  const { allowance } = options;
  if (!allowance) {
    options.report?.absent("plan-allowance");
    return () => Promise.resolve();
  }

  return async ({ project }) => {
    let result: UsageLimitResult;
    try {
      result = await allowance.checkLimit({ teamId: project.teamId });
    } catch (error) {
      options.logger.warn(
        { error, projectId: project.id, teamId: project.teamId },
        "the plan allowance could not be read, so this export is accepted without it",
      );
      return;
    }

    if (!result.exceeded) return;

    options.logger.info(
      {
        projectId: project.id,
        currentMonthMessagesCount: result.count,
        activePlanName: result.planName,
        maxMessagesPerMonth: result.maxMessagesPerMonth,
      },
      "project has reached its plan limit",
    );
    throw new PlanLimitExceededError(result.message, {
      currentMonthMessagesCount: result.count,
      maxMessagesPerMonth: result.maxMessagesPerMonth,
      activePlanName: result.planName,
    });
  };
}

/**
 * Maps the process's one credential resolution onto the collector's own refusal
 * vocabulary.
 */
function toCollectorCredential(
  resolution: Awaited<ReturnType<ApiHandlerManagedCredentials["authenticate"]>>,
): CollectorCredential {
  if (!resolution.ok) {
    return resolution.status === 401
      ? { ok: false, kind: "credential" }
      : { ok: false, kind: "ceiling", status: resolution.status, body: resolution.body };
  }
  const { project, markUsed } = resolution;
  return {
    ok: true,
    project: {
      id: project.id,
      teamId: project.teamId,
      organizationId: project.organizationId,
    },
    markUsed,
  };
}

/**
 * Maps the process's one credential resolution onto the narrow identity the receiver
 * stamps provenance from.
 */
function toOtlpCredential(
  resolution: Awaited<ReturnType<ApiHandlerManagedCredentials["authenticate"]>>,
): OtlpIngestCredential {
  if (!resolution.ok) {
    return { ok: false, status: resolution.status, body: resolution.body };
  }
  const { project, resolved, markUsed } = resolution;
  return {
    ok: true,
    project: {
      id: project.id,
      teamId: project.teamId,
      organizationId: project.organizationId,
    },
    identity:
      resolved.type === "apiKey"
        ? {
            apiKeyId: resolved.apiKeyId,
            organizationId: resolved.organizationId,
            ingestSourceType: resolved.ingestSourceType,
            ingestionTemplateId: resolved.ingestionTemplateId,
          }
        : {
            apiKeyId: null,
            organizationId: project.organizationId,
            ingestSourceType: null,
            ingestionTemplateId: null,
          },
    markUsed,
  };
}

/** The one shape a command dispatcher has, checked rather than asserted. */
type CommandSender = { send(data: unknown): Promise<unknown> };
const isSender = (value: unknown): value is CommandSender =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as CommandSender).send === "function";

/**
 * The `recordSpan` dispatcher off the process's ONE `trace_processing` registration.
 */
function resolveRecordSpan(input: {
  eventing: EventSourcing;
  processName: string;
}): (data: RecordSpanCommandData) => Promise<unknown> {
  const registered =
    tryGetPipeline(input.eventing) ??
    input.eventing.register(
      TraceProcessingProducerAdapter.createTraceProcessingProducerPipeline({
        processName: input.processName,
      }),
    );
  const recordSpan = (registered.commands as Record<string, unknown>).recordSpan;
  if (!isSender(recordSpan)) {
    throw new Error(
      'The trace_processing registration produced no "recordSpan" command sender; the pipeline was registered incompletely.',
    );
  }
  return (data) => recordSpan.send(data);
}

function tryGetPipeline(eventing: EventSourcing): { commands: unknown } | undefined {
  try {
    return eventing.getPipeline(TRACE_PROCESSING_PIPELINE) as unknown as {
      commands: unknown;
    };
  } catch {
    return undefined;
  }
}

class ApiTraceIngressCommandAdapter extends TraceIngressCommandPort {
  static create(
    send: (data: RecordSpanCommandData) => Promise<unknown>,
  ): ApiTraceIngressCommandAdapter {
    return new ApiTraceIngressCommandAdapter(send);
  }

  private constructor(private readonly send: (data: RecordSpanCommandData) => Promise<unknown>) {
    super();
  }

  async recordSpan(data: RecordSpanCommandData): Promise<void> {
    await this.send(data);
  }
}

const SPAN_DEDUP_KEY_PREFIX = "span_dedup:";
/** Short enough that a crashed process's lock expires before a retry needs it. */
const PROCESSING_TTL_SECONDS = 60;
/** Long enough to cover an SDK's own retry window, which is well under an hour. */
const CONFIRMED_TTL_SECONDS = 3600;

/**
 * Best-effort span deduplication, on the same Redis keys every other graph uses. THE KEY
 * FORMAT IS FROZEN.
 */
function composeApiTraceSpanDedup(input: {
  redis: RedisConnection | null | undefined;
  logger: Logger;
  report?: ApiTraceIngestAbsenceReport;
}): TraceSpanDedupPort {
  if (!input.redis) {
    input.report?.absent("dedup");
    return new ApiNullTraceSpanDedupAdapter();
  }
  return new ApiRedisTraceSpanDedupAdapter(input.redis, input.logger);
}

const dedupKey = (span: SpanDedupRef): string =>
  `${SPAN_DEDUP_KEY_PREFIX}${span.tenantId}:${span.traceId}:${span.spanId}`;

class ApiRedisTraceSpanDedupAdapter extends TraceSpanDedupPort {
  constructor(
    private readonly redis: RedisConnection,
    private readonly logger: Logger,
  ) {
    super();
  }

  async tryAcquireProcessingLock(span: SpanDedupRef): Promise<boolean | null> {
    try {
      const claimed = await this.redis.set(
        dedupKey(span),
        "processing",
        "EX",
        PROCESSING_TTL_SECONDS,
        "NX",
      );
      return claimed === "OK";
    } catch (error) {
      this.logger.warn({ error, ...span }, "span dedup claim failed; ingesting anyway");
      return null;
    }
  }

  async confirmProcessed(span: SpanDedupRef): Promise<void> {
    try {
      await this.redis.set(dedupKey(span), "processed", "EX", CONFIRMED_TTL_SECONDS);
    } catch (error) {
      this.logger.warn({ error, ...span }, "span dedup confirmation failed");
    }
  }

  async releaseOnFailure(span: SpanDedupRef): Promise<void> {
    try {
      await this.redis.del(dedupKey(span));
    } catch (error) {
      this.logger.warn({ error, ...span }, "span dedup release failed");
    }
  }
}

/** No Redis: every span is claimed, and a duplicate export records twice. */
class ApiNullTraceSpanDedupAdapter extends TraceSpanDedupPort {
  tryAcquireProcessingLock(): Promise<boolean | null> {
    return Promise.resolve(true);
  }

  confirmProcessed(): Promise<void> {
    return Promise.resolve();
  }

  releaseOnFailure(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * The coding-agent contract, holding only what the ingest path reads. `shouldFilterSpan`
 * is a concrete rule on the base class — it decides from the scope name, the span name
 * and the attribute keys, and reads no store — so it answers correctly here.
 */
class ApiSpanFilterOnlyCodingAgents extends CodingAgentService {
  override shouldFilterSpan(input: CodingAgentSpanFilterInput): boolean {
    return super.shouldFilterSpan(input);
  }

  private unavailable(): Promise<never> {
    return Promise.reject(
      new Error(
        "The API process composes the coding-agent span filter for ingestion only; it holds no coding-agent session store to read.",
      ),
    );
  }

  getSessionEvents(): Promise<never> {
    return this.unavailable();
  }

  tryGetBySessionId(): Promise<never> {
    return this.unavailable();
  }

  tryGetSessionForTrace(): Promise<never> {
    return this.unavailable();
  }

  listRecent(): Promise<never> {
    return this.unavailable();
  }

  backfillPullRequestMappings(): Promise<never> {
    return this.unavailable();
  }

  getUsageTotals(): Promise<never> {
    return this.unavailable();
  }

  listForProject(): Promise<never> {
    return this.unavailable();
  }

  linkTraceSessionsToPullRequests(): Promise<never> {
    return this.unavailable();
  }

  getPullRequestUsage(): Promise<never> {
    return this.unavailable();
  }

  getPullRequestDetail(): Promise<never> {
    return this.unavailable();
  }

  getForPersonalProject(): Promise<never> {
    return this.unavailable();
  }
}
