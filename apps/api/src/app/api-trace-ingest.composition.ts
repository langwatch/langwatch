/**
 * The OTLP receiver, composed from this process's own graph.
 *
 * Ingestion is the one path where this process is a WRITER rather than a
 * reader, and everything below follows from that. A span posted here becomes a
 * `recordSpan` command on the `trace_processing` pipeline the worker drains;
 * nothing is folded, stored or priced here. That is why this composition needs
 * so little — a command queue, a Redis for the dedup claim — and why it refuses
 * outright without the first of them.
 *
 * ## What it composes
 *
 *   - the COMMAND HANDOFF, over the SAME producer registration the annotation
 *     commands use. Registering a second copy of one definition would put the
 *     same aggregate in the event catalogue twice, so this asks the runtime for
 *     the existing registration first and only registers when it is the first
 *     caller to need it.
 *   - the DEDUP CLAIM, on the same Redis keys every other graph uses. The key
 *     format is FROZEN: while more than one graph ingests, the same span may be
 *     claimed by either, and a prefix spelled differently here would give this
 *     process its own keyspace — so a span exported twice would be recorded
 *     twice, once by each.
 *   - the CREDENTIAL, through the process's one
 *     {@link ApiHandlerManagedCredentials}, so the OTLP door and the framework
 *     chain cannot decide differently about the same caller.
 *   - the TRACKED-EVENT SPAN BUILDER, over the same dedup claim and the same
 *     command sender. A customer's feedback event is stored as one synthetic
 *     span whose id is a digest of `${trace_id}:${eventId}`, and the worker
 *     mints the identical span when an SDK reports the same feedback on a
 *     live span — so the two collapse onto one row only while both claim it
 *     against this keyspace.
 *
 *   - the PLAN ALLOWANCE, over the process's own `UsageService`. Both doors
 *     enforce the SAME allowance through the SAME service, because an export
 *     refused on `/api/otel/v1/traces` and accepted on `/api/collector` is a
 *     limit a customer routes around by changing one URL. It refuses with
 *     `ERR_PLAN_LIMIT` and 402 — never 429, which OTel SDKs retry, turning one
 *     terminal rejection into an unbounded loop against a customer who cannot
 *     succeed until they upgrade.
 *
 * ## What is named as absent
 *
 *   - the PLAN ALLOWANCE, on a process that opened no ClickHouse. There is
 *     then nothing to count the month's volume in, and a meter whose every
 *     reading is unknown is not enforcement. An export is accepted, which is
 *     the SAME degradation this path has always had when the allowance LOOKUP
 *     failed — telemetry a customer already paid to produce must not be
 *     dropped by a meter this process cannot read. Reported once at boot, not
 *     per request.
 *   - the LOG and METRIC collections. This process composes neither the log nor
 *     the metric fold, so those two routes are not mounted at all: an exporter
 *     gets a 404 from a receiver that honestly does not serve them, rather than
 *     a 500 from one that pretends to.
 *   - the SOURCE BILLING resolver, which is Enterprise governance's. Traffic on
 *     an ORDINARY project key is unaffected — it carries no source identity to
 *     stamp — and traffic on an INGESTION key is refused by name inside the
 *     family rather than recorded with provenance nobody resolved.
 *   - the CODING-AGENT session reads. The span filter is a rule on the
 *     contract's base class and needs no session store, so it runs; every read
 *     behind it refuses by name, because this composition holds no runtime for
 *     them and a silent empty answer would read as "this session had nothing".
 */
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
  createTraceProcessingProducerPipeline,
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
 * The one allowance question an ingest door asks.
 *
 * `UsageService.checkLimit` satisfies it. It is named here as its own shape so
 * the composition states what an ingestion path is allowed to ask of the
 * entitlement graph — one question, per authenticated batch, about the team
 * the credential opened.
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
   *
   * Narrowed to the one method both doors call rather than taking
   * `UsageService` whole: the service also answers the panel's display total
   * and the warning's per-project breakdown, and neither belongs on an
   * ingestion path. `UsageService` satisfies it.
   */
  allowance?: ApiTraceIngestAllowance | undefined;
  /** Names this process in the producer registration's own refusals. */
  processName: string;
  report?: ApiTraceIngestAbsenceReport;
}>;

/**
 * Every ingest door's ports, composed over ONE dedup gate and ONE command
 * sender.
 *
 * The OTLP receiver, the SDK collector and the tracked-event intake are three
 * wires into one path: the same `trace_processing` producer registration, the
 * same Redis dedup claim, the same coding-agent span filter. One composition
 * rather than three, because a second `TraceIngestionService` would be a
 * second dedup gate — and a span exported to one door and retried against
 * another would be recorded twice.
 */
export type ApiTraceIngestComposition = Readonly<{
  /** `POST /api/otel/v1/*` and its path aliases. */
  otlp: OtlpIngestRestPorts;
  /**
   * The plan allowance the COLLECTOR door enforces — the same object
   * `otlp.usageLimit` is, published separately because the collector's ports
   * are assembled by the root rather than returned whole here.
   *
   * Typed against the collector's narrower input on purpose: it takes the
   * project and nothing else, and the receiver's extra `customerTraceIds` is
   * correlation material this gate does not read.
   */
  usageLimit: CollectorUsageLimitPort;
  /** `POST /api/collector`: one already-normalized span at a time. */
  ingestSpan: CollectorSpanIngestPort;
  /**
   * The collector's own credential resolution, over the SAME
   * `ApiHandlerManagedCredentials` the OTLP door uses. It is mapped to the
   * collector's discriminated refusal rather than passed through, because that
   * family publishes its own unauthenticated sentence.
   */
  collectorCredential: CollectorCredentialPort;
  /**
   * The builder `POST /api/events/track` and `POST /api/track_event` record
   * through: one customer feedback event as the one synthetic span that
   * carries it.
   *
   * On the SAME dedup and command ports as the two doors above, which is what
   * makes a REST rating and an SDK's `langwatch.event` collapse onto one row —
   * the span id is a digest of `${trace_id}:${eventId}`, so it only dedups if
   * both paths claim it against the same keyspace.
   */
  trackedEventSpans: TrackedEventSpanService;
}>;

/**
 * Both ingest doors' ports, or nothing.
 *
 * Nothing when there is no command queue: a receiver that accepts a span and
 * has nowhere to send it answers 200 to data it then drops, which is the one
 * failure an exporter cannot detect and cannot retry.
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
    // A SECOND `TraceSpanCollectionService` over the SAME `dedup` and
    // `commands` objects, not a second gate: the class holds no state of its
    // own beyond those two references, so both instances claim the same Redis
    // keys and send on the same registration. It is built here rather than
    // reached for through `TraceIngestionService` because that class composes
    // its collection privately and exposes only `ingestNormalizedSpan`, and
    // the tracked-event builder needs the collaborator itself.
    trackedEventSpans: TrackedEventSpanService.create({
      collection: TraceSpanCollectionService.create({ dedup, commands }),
    }),
  };
}

/**
 * The gate both ingest doors call before a byte of the batch is parsed.
 *
 * Three outcomes, and only one of them refuses:
 *
 *   - OVER THE ALLOWANCE — throws {@link PlanLimitExceededError}, which the
 *     family's error boundary renders as `{"error":"ERR_PLAN_LIMIT","message":…}`
 *     with a 402. The body is byte-for-byte the one the platform application
 *     published; the STATUS is not, and deliberately: it answered 429, which
 *     the OTel SDKs and most retrying HTTP clients treat as transient, so a
 *     terminal rejection came back until the exporter's elapsed-time budget ran
 *     out. The message is the entitlement package's own — it names the limit,
 *     the unit and where to raise it.
 *   - WITHIN THE ALLOWANCE — returns, and the batch is ingested.
 *   - THE LOOKUP ITSELF FAILED — returns, and the batch is ingested. That
 *     asymmetry is the behaviour this path has always had: a directory or a
 *     rollup that is down must not stop a customer's telemetry, and an
 *     organization that cannot be placed from its team is that same case. It
 *     is logged at warn so a metering outage reads as a metering outage rather
 *     than as a suspiciously quiet month.
 *
 * With no allowance composed there is no gate at all — the absence was already
 * reported at boot, and a per-request line for a decision made once at
 * composition would be one log line per ingested batch.
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
 * Maps the process's one credential resolution onto the collector's own
 * refusal vocabulary.
 *
 * A 401 from the shared resolution means the request carried no usable
 * credential, and the collector answers that in its OWN words — the sentence
 * every LangWatch SDK's error copy quotes. Anything else is a ceiling denial,
 * whose full handled payload the family forwards untouched.
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
 * Maps the process's one credential resolution onto the narrow identity the
 * receiver stamps provenance from.
 *
 * A legacy project key has no key id and no source, which is exactly what
 * `null` says here: it predates RBAC, carries full project access, and can
 * never be an ingestion key.
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
 * The `recordSpan` dispatcher off the process's ONE `trace_processing`
 * registration.
 *
 * Asking the runtime for an existing registration before making one is not
 * defensive tidiness: `register` appends the definition's aggregate to the
 * event catalogue, so registering the same pipeline twice describes one event
 * stream twice. Whichever collaborator needs it first registers it, and every
 * later one takes the same commands.
 */
function resolveRecordSpan(input: {
  eventing: EventSourcing;
  processName: string;
}): (data: RecordSpanCommandData) => Promise<unknown> {
  const registered =
    tryGetPipeline(input.eventing) ??
    input.eventing.register(
      createTraceProcessingProducerPipeline({ processName: input.processName }),
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
 * Best-effort span deduplication, on the same Redis keys every other graph
 * uses.
 *
 * THE KEY FORMAT IS FROZEN. While more than one graph ingests, the same span
 * may be claimed by either process, and a prefix or separator spelled
 * differently here would give this process its own keyspace — so a span
 * exported twice would be recorded twice, once by each graph.
 *
 * DEDUP NEVER BLOCKS INGESTION. The claim answers `null` when Redis is
 * unreachable and the caller ingests anyway, because losing a cache is not a
 * reason to lose a customer's span; the other two operations report and
 * continue, because failing to tidy up after one span must not fail the span.
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
 * The coding-agent contract, holding only what the ingest path reads.
 *
 * `shouldFilterSpan` is a concrete rule on the base class — it decides from the
 * scope name, the span name and the attribute keys, and reads no store — so it
 * answers correctly here. Every session read below refuses by name rather than
 * answering empty: an empty answer would be read as "this coding session
 * recorded nothing", which is a different and wrong fact.
 *
 * The same stand-in shape `createTraceProcessingProducerPipeline` uses for the
 * consumer-side collaborators a producer does not hold.
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
