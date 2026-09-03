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
 * ## What is named as absent
 *
 *   - the PLAN ALLOWANCE. Not for want of a plan: this process composes a
 *     `PlanProvider` and eight surfaces already read allowances through it.
 *     What has no implementation ANYWHERE is the enforcement pair
 *     `UsageService` needs — `UsageOrganizationPort` (team to organization,
 *     its projects, its pricing model) and `UsageVolumeCounterPort`
 *     (`getCountByProjects` for traces and events) — so `UsageService` is
 *     composed by no process and `checkLimit` is called by nothing. Until they
 *     exist, an export degrades exactly the way the receiver has always
 *     degraded when the allowance LOOKUP fails — the batch is accepted —
 *     because telemetry a customer already paid to produce must not be dropped
 *     by a meter no tier can read. Reported once at boot, not per request.
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
          : "no usage enforcement: UsageOrganizationPort and UsageVolumeCounterPort have no implementation in any tier, so an OTLP export is accepted without checking the plan's monthly allowance",
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

  report?.absent("plan-allowance");

  const authenticate = (request: Request) =>
    options.credentials.authenticate({ request, permission: "traces:create" });

  return {
    otlp: {
      credential: async ({ request }) => toOtlpCredential(await authenticate(request)),
      // The allowance this process cannot read. Returning is the same outcome the
      // receiver has always had when the lookup itself failed.
      usageLimit: () => Promise.resolve(),
      traces: ({ tenantId, traceRequest }) =>
        ingestion.handleOtlpTraceRequest(tenantId, traceRequest, DEFAULT_PII_REDACTION_LEVEL),
    },
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
