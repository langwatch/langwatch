import type {
  AutomationPersistCapBreach,
  DatasetActionParams,
} from "@langwatch/automation-contract";
import type { DatasetRecordEntry } from "@langwatch/dataset-contract";
import {
  AutomationClockPort,
  AutomationDatasetMapperPort,
  AutomationPersistActionService,
  AutomationPersistActionWriterPort,
  AutomationScheduledIntentPort,
  AutomationSettlementBreachPort,
  AutomationSettlementDispatchService,
  AutomationSettlementEvaluationReaderPort,
  AutomationSettlementFilterEvaluatorPort,
  AutomationSettlementMatchConfirmationService,
  AutomationSettlementObservabilityPort,
  AutomationSettlementTraceReaderPort,
  AutomationEmailCapService,
  AutomationHeartbeatPort,
  AutomationLoggerPort,
  AutomationNotificationDeliveryPort,
  createAutomationsPipeline,
  GraphTriggerHeartbeatService,
  PostgresAutomationSettlementLedgerAdapter,
  PrismaGraphTriggerSentRepository,
  PrismaTriggerRepository,
  PrismaWebhookDeliveryRepository,
  SlackProviderAdapter,
  WebhookProviderAdapter,
  type AutomationEvent,
  type AutomationGraphActivityPort,
  type AutomationIntentRetentionPort,
  type AutomationProjectIdentityPort,
  type AutomationSettlementLedgerDatabase,
  type AutomationSecretCrypto,
} from "@langwatch/automation-server";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import { DispatchError } from "@langwatch/eventing";
import { createLogger, type Logger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";
import {
  mapTraceToDatasetEntry,
  traceSchema,
  TRACE_EXPANSIONS,
  type DerivedTraceEvent,
  type TraceRecord,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { TraceQueryEvaluationService } from "@langwatch/trace-server";
import type { AutomationWorkerCapability } from "../features/automation/automation-worker-feature.installer";
import type { WorkerConfig } from "../platform/config/worker.config";

export type WorkerAutomationSettlementCompositionOptions = Readonly<{
  config: WorkerConfig;
  prisma: AutomationSettlementLedgerDatabase;
  clock: AutomationClockPort;
  /**
   * The transports a settled digest leaves through, and the origin its links
   * point at. Absent exactly when this deployment named no `BASE_HOST`.
   */
  notifications?: AutomationSettlementNotifications | undefined;
  projects: AutomationProjectIdentityPort;
  traces: AutomationSettlementTraceReaderPort;
  evaluations: AutomationSettlementEvaluationReaderPort;
  /** The graph half, when this process composed one. */
  graphActivity?: AutomationGraphActivityPort | undefined;
  /** Reads the recency the heartbeat sweep decides absence from. */
  heartbeat: AutomationHeartbeatPort;
  /**
   * Where an `ADD_TO_DATASET` automation appends its mapped rows.
   *
   * The dataset feature's own service, narrowed to the one call this path
   * makes. Absent exactly when this graph composed no typed Prisma client, in
   * which case the record it would map cannot be read either.
   */
  datasets?: WorkerAutomationDatasetWriter | undefined;
  redis?: RedisConnection | null;
  absence?: WorkerAutomationSettlementAbsenceReportPort;
  logger?: Logger;
}>;

/**
 * The delivery collaborators settlement SHARES with the graph vertical.
 *
 * Shared deliberately. Both halves send to the same customer through the same
 * transports and count against the same hourly and daily email ceilings, so a
 * process composing two of each would let one half spend the budget the other
 * was protecting — a burst from settlement and silence from the graph alerts.
 */
export type AutomationSettlementDeliveryComposition = Readonly<{
  delivery: AutomationNotificationDeliveryPort;
  emailCaps: AutomationEmailCapService;
  crypto: AutomationSecretCrypto;
}>;

/** Those transports plus the origin every link in a digest is built from. */
export type AutomationSettlementNotifications = AutomationSettlementDeliveryComposition &
  Readonly<{ baseHost: string }>;

/**
 * The ONE dataset write `ADD_TO_DATASET` makes, declared where it is made.
 *
 * `DatasetService` is twenty-odd methods over datasets, records, uploads and
 * chunked content; this path reaches one, and it is the same one the
 * application called. Naming the method rather than the service is what keeps a
 * process that settles matches from having to compose the upload half.
 */
export type WorkerAutomationDatasetWriter = Pick<DatasetService, "batchCreateRecords">;

/**
 * What this process CANNOT do about a settled match, said once at composition.
 *
 * Every member is a capability the application has and this process does not,
 * and each one is reported rather than inferred: a settlement graph that
 * quietly did four fifths of the job would look identical from the outside to
 * one that did all of it, right up until a customer asked why their dataset
 * never filled.
 */
export abstract class WorkerAutomationSettlementAbsenceReportPort {
  /**
   * Legacy `filters` matching, for automations written before the LWQL
   * `filterQuery` migration.
   *
   * The matcher and the field schema it parses against live in the analytics
   * WEB package, which a background process must not import — it would put
   * React on the boot graph. An automation carrying a `filterQuery` confirms
   * normally; one still carrying the old `filters` map is refused BY NAME at
   * confirmation, so it dead-letters visibly rather than silently never firing.
   */
  abstract withoutLegacyFilterMatching(): void;

  /**
   * The full trace record, spans and all.
   *
   * Two paths want it: the digest's fallback when the summary fold has not
   * landed, and `ADD_TO_DATASET`'s row mapping. Reported by the trace-read
   * composition rather than here, because that is where the decision is made:
   * the read is Trace's own packaged legacy read over the typed Prisma client,
   * and a graph given no client can compose none.
   */
  abstract withoutTraceRecordRead(): void;

  /**
   * `ADD_TO_DATASET`'s WRITE.
   *
   * The row MAPPING is composed unconditionally — `mapTraceToDatasetEntry` and
   * `TRACE_EXPANSIONS` are `@langwatch/trace-contract`'s, so the columns this
   * process fills are the columns the customer previewed. What can be absent is
   * the dataset service the mapped rows are appended through, which is composed
   * over the typed Prisma client and this process's own object storage.
   */
  abstract withoutDatasetPersist(): void;

  /**
   * `ADD_TO_ANNOTATION_QUEUE`, whose writer is Annotation's own service.
   *
   * `createOrUpdateQueueItems` is exported from `@langwatch/annotation-server`
   * and every collaborator it takes is one this process holds. The package is
   * not a dependency of this one, and adding one is a manifest change rather
   * than wiring — so the action is refused BY NAME here.
   */
  abstract withoutAnnotationQueuePersist(): void;

  /**
   * Runaway containment.
   *
   * The breach is still counted and still logged with the project, the trigger
   * and the skipped total; what an absent notifier costs is the mail to the
   * organization's admins and the auto-pause of a misconfigured automation.
   */
  abstract withoutRunawayContainment(): void;

  /** The plan lookup behind the daily persist ceiling; the paid tier is used. */
  abstract withoutPlanResolvedPersistCap(): void;

  /** The graph-alert evaluator the 30-second sweep re-evaluates through. */
  abstract withoutGraphAlertEvaluation(): void;

  /**
   * Every outbound transport a settled digest would leave through.
   *
   * Reported when the deployment named no `BASE_HOST`. Matches still settle,
   * still claim and still stamp their automation's last run; what cannot happen
   * is the notification, because a digest with no origin to link back to is
   * mail nobody can act on.
   */
  abstract withoutNotificationDelivery(): void;
}

/**
 * Automation's settlement half, composed from this process's own substrates.
 *
 * The pipeline itself was already packaged — `createAutomationsPipeline` is the
 * feature's own definition and takes exactly three collaborators. What was not
 * packaged is the settlement EXECUTOR behind one of them, which named three
 * whole capability services (`AutomationService`, `ProjectService`,
 * `TraceService`) to reach ten methods, one method and four methods
 * respectively. Those are now three narrow ports, so this root composes the ten
 * over its own Prisma client and the five reads over its own ClickHouse rather
 * than borrowing the application's graph.
 *
 * Two of the three process managers register no routing key: `graphAlertSweep`
 * and `webhookDeliveryPrune` declare no event types, and
 * `ProcessRuntime.registerPipeline` skips the subscriber for a definition with
 * an empty event list. They still WAKE on their schedules here, which is why
 * their collaborators are composed for real rather than refused.
 */
export function createWorkerAutomationSettlement(
  options: WorkerAutomationSettlementCompositionOptions,
): AutomationWorkerCapability<AutomationEvent> {
  const logger = options.logger ?? createLogger("langwatch:automation:settlement");
  const absence = options.absence;
  if (!options.graphActivity) absence?.withoutGraphAlertEvaluation();
  if (!options.notifications) absence?.withoutNotificationDelivery();
  absence?.withoutLegacyFilterMatching();
  if (!options.datasets) absence?.withoutDatasetPersist();
  absence?.withoutAnnotationQueuePersist();
  absence?.withoutRunawayContainment();
  absence?.withoutPlanResolvedPersistCap();

  const ledger = PostgresAutomationSettlementLedgerAdapter.create({
    prisma: options.prisma,
    clock: options.clock,
    redis: options.redis ?? null,
    // The paid ceiling, stated rather than resolved. See the config leaf.
    persistCap: { kind: "fixed", cap: options.config.automation.persistDailyCapPaid },
    breach: new LoggedSettlementBreach(logger),
  });
  const notifications = options.notifications ?? unavailableNotifications();
  const settlement = AutomationSettlementDispatchService.create({
    automation: ledger,
    projects: options.projects,
    traces: options.traces,
    baseHost: notifications.baseHost,
    confirmation: AutomationSettlementMatchConfirmationService.create({
      evaluations: options.evaluations,
      traces: options.traces,
      filterEvaluator: new WorkerSettlementFilterEvaluator(),
    }),
    persistActions: AutomationPersistActionService.create({
      automation: ledger,
      projects: options.projects,
      traces: options.traces,
      mapper: new WorkerAutomationDatasetMapper(),
      writer: new WorkerAutomationPersistActionWriter(options.datasets),
    }),
    delivery: notifications.delivery,
    emailCaps: notifications.emailCaps,
    slack: SlackProviderAdapter.create(notifications.crypto),
    webhooks: WebhookProviderAdapter.create(notifications.crypto),
    clock: options.clock,
    observability: new LoggedSettlementObservability(logger),
    emailHourlyCap: options.config.automation.emailHourlyCap,
    tenantDailyCap: options.config.automation.tenantDailyCap,
  });
  const scheduledIntents = WorkerAutomationScheduledIntents.create({
    prisma: options.prisma,
    clock: options.clock,
    heartbeat: options.heartbeat,
    logger,
    ...(options.graphActivity ? { graphActivity: options.graphActivity } : {}),
  });

  return {
    buildPipeline: ({ retention }: { retention: AutomationIntentRetentionPort }) =>
      createAutomationsPipeline({ scheduledIntents, settlement, retention }),
  };
}

/**
 * The transports of a process that has none, refusing by name.
 *
 * Every member throws rather than resolving, so a deployment that settles
 * matches but named no `BASE_HOST` dead-letters its first digest with a message
 * saying exactly that — instead of claiming the send, stamping the automation
 * and delivering nothing.
 */
function unavailableNotifications(): AutomationSettlementNotifications {
  const message =
    "This process composes no outbound automation delivery: it named no BASE_HOST, so a digest would carry links back to nowhere. Set BASE_HOST to send settled notifications from here.";
  const refuse = (): never => {
    throw new DispatchError({ message, retryable: false });
  };

  return {
    baseHost: "",
    delivery: new UnavailableNotificationDelivery(message),
    emailCaps: AutomationEmailCapService.create({ store: null }),
    crypto: { encrypt: refuse, decrypt: refuse },
  };
}

class UnavailableNotificationDelivery extends AutomationNotificationDeliveryPort {
  constructor(private readonly message: string) {
    super();
  }

  sendLegacyEmail(): Promise<void> {
    return this.refuse();
  }
  sendEmail(): Promise<void> {
    return this.refuse();
  }
  sendSlackWebhook(): Promise<void> {
    return this.refuse();
  }
  sendLegacySlackWebhook(): Promise<void> {
    return this.refuse();
  }
  sendSlackBot(): Promise<void> {
    return this.refuse();
  }
  sendWebhook(): Promise<never> {
    return this.refuse();
  }

  private refuse(): Promise<never> {
    return Promise.reject(new DispatchError({ message: this.message, retryable: false }));
  }
}

/**
 * A settled match's re-check against its own trace, over the two grammars
 * automations are written in.
 *
 * The LWQL half is REAL: `TraceQueryEvaluationService` is Trace's own
 * evaluator, so a filter query decides the same way in this process as in the
 * application. The legacy half refuses, and refuses TERMINALLY — a settlement
 * that returned `false` would look exactly like an automation whose condition
 * was not met, so the customer would see silence and we would see nothing at
 * all.
 */
class WorkerSettlementFilterEvaluator extends AutomationSettlementFilterEvaluatorPort {
  matchesFilterQuery(input: {
    query: string;
    foldState: TraceSummaryData;
    evaluations: EvaluationRunData[] | null;
    events: DerivedTraceEvent[] | null;
  }): boolean {
    return TraceQueryEvaluationService.matches(input.query, {
      summary: input.foldState,
      evaluations: input.evaluations,
      events: input.events,
      spans: null,
    });
  }

  matchesTraceFilters(): boolean {
    throw this.unavailable();
  }

  matchesEvaluationFilters(): boolean {
    throw this.unavailable();
  }

  private unavailable(): DispatchError {
    return new DispatchError({
      message:
        "This process cannot match an automation's legacy filters: the two functions that walked them — the trace-data matcher and the fold-state projection it reads — left the tree with the platform application and were not re-homed, so no process has them. The field matchers they stood on survive as a React-free server subpath of the analytics package. Re-save the automation to convert it to a filter query.",
      retryable: false,
    });
  }
}

/**
 * `ADD_TO_DATASET`'s row mapping, over the rules the customer previewed with.
 *
 * `mapTraceToDatasetEntry` and `TRACE_EXPANSIONS` are `@langwatch/trace-contract`'s
 * — the SAME functions the mapping editor drives its preview from — so a
 * dataset filled here holds the columns the customer saw before saving. A
 * second implementation of the expansion rules is what would fill datasets that
 * disagreed with the preview, which is why this maps rather than re-derives.
 *
 * Composed unconditionally: it is a pure function of the record it is handed,
 * so it has nothing to be absent. A process that cannot read a record never
 * reaches it (`dispatchToDataset` reads first), and one that cannot write the
 * mapped rows refuses at the writer below.
 */
class WorkerAutomationDatasetMapper extends AutomationDatasetMapperPort {
  map(input: {
    trace: TraceRecord;
    mapping: DatasetActionParams["datasetMapping"]["mapping"];
    expansions: readonly string[];
  }): Array<Record<string, string | number>> {
    const trace = traceSchema.parse(input.trace);
    const expansions = new Set(
      input.expansions.filter(
        (value): value is keyof typeof TRACE_EXPANSIONS => value in TRACE_EXPANSIONS,
      ),
    );

    return mapTraceToDatasetEntry(trace, input.mapping, expansions);
  }
}

/**
 * The two persist writes: the dataset append for real, the queue by name.
 *
 * The dataset half is Dataset's own `batchCreateRecords`, which is the one call
 * the application made — including the chunked `s3_jsonl` branch, because the
 * service is composed with this process's own storage resolver rather than
 * with the Postgres half alone.
 *
 * The annotation half refuses, and the refusal names a MANIFEST line rather
 * than a missing capability: `createOrUpdateQueueItems` is exported from
 * `@langwatch/annotation-server`, `PostgresAnnotationAdapter` takes a database,
 * a project service and an organization service — all three of which this
 * process holds — and the package is simply not a dependency of this one.
 */
class WorkerAutomationPersistActionWriter extends AutomationPersistActionWriterPort {
  constructor(private readonly datasets: WorkerAutomationDatasetWriter | undefined) {
    super();
  }

  addToAnnotationQueue(): Promise<void> {
    return Promise.reject(
      new DispatchError({
        message:
          "This process composes no annotation queue writer, so an automation cannot add a trace to one from here: the queueing service is packaged and every collaborator it takes is one this process holds, but `@langwatch/annotation-server` is not a dependency of this process, so nothing here can import it.",
        retryable: false,
      }),
    );
  }

  async addToDataset(input: {
    datasetId: string;
    projectId: string;
    datasetRecords: DatasetRecordEntry[];
  }): Promise<void> {
    const datasets = this.datasets;
    if (!datasets) {
      throw new DispatchError({
        message:
          "This process composes no dataset writer, so an automation cannot add a trace to a dataset from here: the write is composed over the typed Prisma client this graph was given, and it was given none.",
        retryable: false,
      });
    }

    await datasets.batchCreateRecords({
      slugOrId: input.datasetId,
      projectId: input.projectId,
      entries: input.datasetRecords,
    });
  }
}

/**
 * The two schedules, and the graph evaluation one of them drives.
 *
 * Neither registers a routing key — both process managers declare no event
 * types — but both still wake on their own interval in this process, so
 * composing them as refusals would stop a no-data alert firing and let the
 * webhook delivery log grow without bound.
 */
class WorkerAutomationScheduledIntents extends AutomationScheduledIntentPort {
  static create(input: {
    prisma: AutomationSettlementLedgerDatabase;
    clock: AutomationClockPort;
    heartbeat: AutomationHeartbeatPort;
    logger: Logger;
    graphActivity?: AutomationGraphActivityPort;
  }): WorkerAutomationScheduledIntents {
    return new WorkerAutomationScheduledIntents(
      GraphTriggerHeartbeatService.create({
        triggers: PrismaTriggerRepository.create(input.prisma, input.clock),
        triggerSent: PrismaGraphTriggerSentRepository.create(input.prisma),
        heartbeat: input.heartbeat,
        logger: new WorkerSettlementLogger(input.logger),
      }),
      PrismaWebhookDeliveryRepository.create(input.prisma),
      input.graphActivity,
    );
  }

  private constructor(
    private readonly heartbeat: GraphTriggerHeartbeatService,
    private readonly deliveries: { pruneExpired(now?: Date): Promise<number> },
    private readonly graphActivity: AutomationGraphActivityPort | undefined,
  ) {
    super();
  }

  decideGraphTriggerHeartbeat(input: { now: Date }) {
    return this.heartbeat.decide(input);
  }

  evaluateGraphTrigger(input: {
    triggerId: string;
    projectId: string;
    reason: Parameters<AutomationGraphActivityPort["evaluateGraphTrigger"]>[0]["reason"];
  }) {
    if (!this.graphActivity) {
      return Promise.reject(
        new DispatchError({
          message:
            "This process composes no graph-alert vertical, so a sweep candidate cannot be evaluated here. Set BASE_HOST to compose one.",
          retryable: false,
        }),
      );
    }

    return this.graphActivity.evaluateGraphTrigger(input);
  }

  pruneWebhookDeliveries(now?: Date): Promise<number> {
    return this.deliveries.pruneExpired(now);
  }
}

/** Automation's logger port, over this process's own logger. */
class WorkerSettlementLogger extends AutomationLoggerPort {
  constructor(private readonly logger: Logger) {
    super();
  }

  error(fields: Record<string, unknown>, message: string): void {
    this.logger.error(fields, message);
  }
  debug(fields: Record<string, unknown>, message: string): void {
    this.logger.debug(fields, message);
  }
  info(fields: Record<string, unknown>, message: string): void {
    this.logger.info(fields, message);
  }
  warn(fields: Record<string, unknown>, message: string): void {
    this.logger.warn(fields, message);
  }
}

/**
 * Settlement's two observability calls, over this process's logger.
 *
 * The application increments a Prometheus counter and captures to PostHog.
 * This process has neither registry, and inventing a second counter name for
 * the same event would split one series in two — so both land as log lines
 * carrying the same fields the counter carried as labels.
 */
class LoggedSettlementObservability extends AutomationSettlementObservabilityPort {
  constructor(private readonly logger: Logger) {
    super();
  }

  recordOverflow(flushed: number): void {
    this.logger.warn({ flushed }, "Automation settlement flushed matches early to stay in bounds");
  }

  capture(error: Error, extra: Record<string, unknown>): void {
    this.logger.error({ ...extra, error: error.message }, "Automation settlement dispatch failed");
  }
}

/** Containment refused by name, with the breach still recorded. */
class LoggedSettlementBreach extends AutomationSettlementBreachPort {
  constructor(private readonly logger: Logger) {
    super();
  }

  async handle(input: AutomationPersistCapBreach): Promise<void> {
    this.logger.error(
      {
        projectId: input.projectId,
        triggerId: input.trigger.id,
        cap: input.cap,
        count: input.count,
        skipped: input.skipped,
      },
      "Automation passed its daily ceiling on confirmed matches and further matches are being skipped; this process composes no runaway containment, so nobody has been notified and the automation has not been paused",
    );
  }
}
