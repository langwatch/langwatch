import type { AnalyticsApi, AnalyticsService } from "@langwatch/analytics-contract";
import type {
  GraphTriggerEvaluationResult,
  GraphTriggerSweepCandidate,
  ReportTraceRow,
  AutomationEvaluationSubscriberService as AutomationEvaluationSubscriber,
} from "@langwatch/automation-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { DispatchError } from "@langwatch/eventing";
import type { ScheduledJobFire } from "@langwatch/eventing/server";
import { defineServerModule } from "@langwatch/kernel";
import type { ProjectApi } from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";
import type { TraceListItem } from "@langwatch/trace-contract";

import { AutomationApp } from "./app/automation.app.ts";
import type {
  AutomationClock,
  AutomationDispatchError,
  AutomationEvaluationQueryClassification,
  AutomationEvaluationTraceSummary,
  AutomationGraphActivity,
  AutomationLogger,
  AutomationProjectDirectory,
  AutomationTriggerMatchRecorder,
} from "./app/automation.members.ts";
import type { AutomationNotificationDelivery } from "./channels/automation-notification-delivery.channel.ts";
import type { AutomationRunawayNotice } from "./channels/automation-runaway-notice.channel.ts";
import type { SchedulerWake } from "./channels/automation-scheduler-wake.channel.ts";
import type { AutomationEmailCapRepository } from "./repositories/automation-email-cap.repository.ts";
import type { AutomationPersistActionWriter } from "./repositories/automation-persist-action.repository.ts";
import type { AutomationPersistCapRepository } from "./repositories/automation-persist-cap.repository.ts";
import { automationRepositories } from "./repositories/automation-repositories.registry.ts";
import type { AutomationRunaway } from "./repositories/automation-runaway.repository.ts";
import type { AutomationScheduledJobRepository } from "./repositories/automation-scheduled-job.repository.ts";
import type { AutomationSettlementLedger } from "./repositories/automation-settlement-ledger.repository.ts";
import { AutomationSettlementBreach } from "./repositories/automation-settlement-ledger.repository.ts";
import type {
  AutomationSettlementEvaluationReader,
  AutomationSettlementTraceReader,
} from "./repositories/automation-settlement-read.repository.ts";
import type { AutomationTraceTriggerCatalogue } from "./repositories/automation-trace-trigger-catalogue.repository.ts";
import type { CustomGraphRepository } from "./repositories/custom-graph.repository.ts";
import type { GraphTriggerSentRepository } from "./repositories/graph-trigger-sent.repository.ts";
import {
  PostgresAutomationGraphActivityAdapter,
  type AutomationGraphActivityDatabase,
} from "./repositories/prisma/prisma.automation-graph-activity.repository.ts";
import { PostgresAutomationGraphDeliveryAdapter } from "./repositories/prisma/prisma.automation-graph-delivery.repository.ts";
import {
  PrismaAutomationSettlementLedgerRepository,
  type AutomationSettlementLedgerDatabase,
} from "./repositories/prisma/prisma.automation-settlement-ledger.repository.ts";
import type { AutomationTraceTriggerCatalogueDatabase } from "./repositories/prisma/prisma.automation-trace-trigger-catalogue.repository.ts";
import { PrismaAutomationTraceTriggerCatalogueRepository } from "./repositories/prisma/prisma.automation-trace-trigger-catalogue.repository.ts";
import {
  PrismaCustomGraphRepository,
  type CustomGraphDatabase,
} from "./repositories/prisma/prisma.custom-graph.repository.ts";
import type { EmailSuppressionDatabase } from "./repositories/prisma/prisma.email-suppression.repository.ts";
import {
  PrismaGraphTriggerSentRepository,
  type GraphTriggerSentDatabase,
} from "./repositories/prisma/prisma.graph-trigger-sent.repository.ts";
import {
  PrismaTriggerFireHistoryRepository,
  type TriggerFireHistoryDatabase,
} from "./repositories/prisma/prisma.trigger-fire-history.repository.ts";
import {
  PrismaTriggerRepository,
  type TriggerDatabase,
} from "./repositories/prisma/prisma.trigger.repository.ts";
import {
  PrismaWebhookDeliveryRepository,
  type WebhookDeliveryDatabase,
} from "./repositories/prisma/prisma.webhook-delivery.repository.ts";
import type { TriggerRepository } from "./repositories/trigger.repository.ts";
import type { WebhookDeliveryRepository } from "./repositories/webhook-delivery.repository.ts";
import type { AutomationDatasetMapper } from "./services/automation-dataset-mapper.service.ts";
import { AutomationEvaluationSubscriberService } from "./services/automation-evaluation-subscriber.service.ts";
import { AutomationEvaluationTriggerFilterService } from "./services/automation-evaluation-trigger-filter.service.ts";
import type { AutomationRunawaySignals } from "./services/automation-runaway-signals.service.ts";
import { AutomationScheduledIntent } from "./services/automation-scheduled-intent.service.ts";
import type { AutomationSettlementExecutor } from "./services/automation-settlement-executor.service.ts";
import type { AutomationSettlementLedgerService } from "./services/automation-settlement-ledger.service.ts";
import { AutomationSettlementMatchConfirmationService } from "./services/automation-settlement-match-confirmation.service.ts";
import type { AutomationSettlementObservability } from "./services/automation-settlement-observability.service.ts";
import type { AutomationSettlementFilterEvaluator } from "./services/automation-settlement-policy.service.ts";
import {
  AutomationSlackSecretsService,
  type AutomationSecretCrypto,
} from "./services/automation-slack-secrets.service.ts";
import { AutomationWebhookSecretsService } from "./services/automation-webhook-secrets.service.ts";
import { AutomationEmailCapService } from "./services/email-cap.service.ts";
import { GraphTriggerHeartbeatService } from "./services/graph-trigger-heartbeat.service.ts";
import { AutomationPersistActionService } from "./services/persist-action.service.ts";
import { AutomationPersistCapService } from "./services/persist-cap.service.ts";
import { ReportChartService, type ReportChartDeps } from "./services/report-chart.service.ts";
import {
  ReportDispatchService,
  type ReportDispatchDeps,
} from "./services/report-dispatch.service.ts";
import { ReportScheduleService } from "./services/report-schedule.service.ts";
import { ReportTraceRowService } from "./services/report-trace-row.service.ts";
import { RunawayContainmentService } from "./services/runaway-containment.service.ts";
import {
  TriggerNoReplyService,
  TriggerNoReplyWarning,
} from "./services/trigger-no-reply.service.ts";
import { AutomationSettlementDispatchService } from "./services/trigger-settlement-dispatch.service.ts";
import {
  UnsubscribeTokenService,
  type UnsubscribeTokenPayload,
} from "./services/unsubscribe-token.service.ts";
import { createAutomationRest } from "./transport/automation.rest.ts";
import { automationTrpcTransport } from "./transport/automation.trpc.ts";
import { emailSuppressionTrpcTransport } from "./transport/email-suppression.trpc.ts";
import { slackAutomationRest } from "./transport/slack-trigger.rest.ts";
import { unsubscribeRest } from "./transport/unsubscribe.rest.ts";

export type { AutomationInfrastructure } from "./app/automation.app.ts";

export const automationServer = defineServerModule("automation")
  .withRepositories(automationRepositories)
  .withApp(AutomationApp)
  .withTransports(
    createAutomationRest(),
    automationTrpcTransport,
    emailSuppressionTrpcTransport,
    slackAutomationRest,
    unsubscribeRest,
  );

/**
 * The envelope a trigger's mail leaves in: who it appears to come from,
 * and the token that stops it. Both are HMACs over one secret, composed
 * together so signing them differently could honour an unissued link.
 */
export type AutomationMailEnvelope = Readonly<{
  /** The `To:` a trigger's mail is addressed to, with recipients in bcc. */
  noReplyAddressFor(input: { defaultFrom: string; triggerId: string }): string;
  /** The signed token the unsubscribe footer's link carries. */
  signUnsubscribeToken(payload: UnsubscribeTokenPayload): string;
}>;

export function createAutomationMailEnvelope(input: {
  /**
   * `NEXTAUTH_SECRET`, as the application spells it. Absent degrades
   * unguessability, never blocks.
   */
  secret: string | undefined;
  /** Told once, when the deployment named no secret and the tag is forgeable. */
  onUnguessableAddress?: (message: string) => void;
}): AutomationMailEnvelope {
  const tokens = UnsubscribeTokenService.create({ secret: input.secret });
  const warn = input.onUnguessableAddress;
  const addresses = TriggerNoReplyService.create({
    secret: input.secret,
    ...(warn ? { warnings: new ReportedNoReplyWarning(warn) } : {}),
  });

  return {
    noReplyAddressFor: (address) => addresses.addressFor(address),
    signUnsubscribeToken: (payload) => tokens.sign(payload),
  };
}

class ReportedNoReplyWarning extends TriggerNoReplyWarning {
  constructor(private readonly report: (message: string) => void) {
    super();
  }

  unguessabilityUnavailable(message: string): void {
    this.report(message);
  }
}

/**
 * The email ceilings both halves of this feature spend against. Composed
 * once per process, since two services counting the same budget separately
 * would let one fleet send double; with no shared store, it counts per pod.
 */
export function createAutomationEmailCaps(input: {
  store: AutomationEmailCapRepository | null;
}): AutomationEmailCapService {
  return AutomationEmailCapService.create(input);
}

/**
 * The graph-alert vertical, over substrates the composing process owns:
 * which tables it reads, which secrets it decrypts and which schedule it
 * checks; the process supplies the client, clock, transports and ceilings.
 */
export function createAutomationGraphActivity(input: {
  /** The one database client the composing process opened. */
  prisma: AutomationGraphActivityDatabase;
  clock: AutomationClock;
  projects: AutomationProjectDirectory;
  analytics: AnalyticsService;
  /** The process's outbound transports: mail, Slack, webhook. */
  delivery: AutomationNotificationDelivery;
  /** Reads the Slack bot tokens and webhook secrets this deployment wrote. */
  crypto: AutomationSecretCrypto;
  emailCaps: AutomationEmailCapService;
  logger: AutomationLogger;
  /** How the process's queue tells a permanent failure from a retryable one. */
  dispatchErrors: AutomationDispatchError;
  /** The deployment's own origin; every link in an alert is built from it. */
  baseHost: string;
  emailHourlyCap: number;
  tenantDailyCap: number;
}): AutomationGraphActivity {
  return PostgresAutomationGraphActivityAdapter.create(input);
}

/**
 * What this feature does when an evaluation finishes: decide whether the
 * run matched a trigger, and re-check the graph alerts it feeds. The
 * filter is built here, not handed in, so a caller can't reclassify a query.
 */
export function createAutomationEvaluationSubscriber(input: {
  triggers: AutomationTraceTriggerCatalogue;
  graphActivity: AutomationGraphActivity;
  /** The trace summary a match is confirmed against, and how its query is read. */
  traces: AutomationEvaluationTraceSummary & AutomationEvaluationQueryClassification;
  triggerMatches: AutomationTriggerMatchRecorder;
}): AutomationEvaluationSubscriber {
  return AutomationEvaluationSubscriberService.create({
    triggers: input.triggers,
    graphActivity: input.graphActivity,
    traces: input.traces,
    evaluationFilters: AutomationEvaluationTriggerFilterService.create(input.traces),
    triggerMatches: input.triggerMatches,
  });
}

/** Every table the scheduled-report calendar reads or writes. */
export type AutomationReportCalendarDatabase = TriggerDatabase &
  TriggerFireHistoryDatabase &
  CustomGraphDatabase &
  EmailSuppressionDatabase &
  WebhookDeliveryDatabase;

/**
 * The scheduled-report calendar this feature contributes to a process that runs
 * one: the reconciler its boot sweeps with, and the handler its scheduler fires.
 */
export type AutomationReportCalendar = Readonly<{
  /** Reads, writes and repairs the calendar rows behind report automations. */
  schedules: ReportScheduleService;
  /** Renders one due report and sends it through the process's own transports. */
  dispatchScheduledReport(fire: ScheduledJobFire): Promise<void>;
  /** A trace-list row as a report's template renders it. */
  toReportTraceRow(input: { item: TraceListItem; projectUrl: string }): ReportTraceRow;
}>;

export function createAutomationReportCalendar(input: {
  /** The one database client the composing process opened. */
  database: AutomationReportCalendarDatabase;
  clock: AutomationClock;
  /** Where the process keeps its due-job rows, and how it wakes its peers. */
  jobs: AutomationScheduledJobRepository;
  wake: SchedulerWake;
  /** The name and slug a report's links and headings are written with. */
  projects: AutomationProjectDirectory;
  /** The transports a report leaves through — the same ones every other notification uses. */
  delivery: AutomationNotificationDelivery;
  /** Reads the stored Slack bot token off a report trigger's action parameters. */
  crypto: AutomationSecretCrypto;
  /** The timeseries each chart panel is plotted from. */
  getTimeseries: ReportChartDeps["getTimeseries"];
  /** The traces a trace-query report lists, over the process's own trace tier. */
  listReportTraces: ReportDispatchDeps["listReportTraces"];
  /** This deployment's public origin. Every link in the message goes through it. */
  baseHost: string;
}): AutomationReportCalendar {
  const { database, clock } = input;
  const triggers = PrismaTriggerRepository.create(database, clock);
  const fires = PrismaTriggerFireHistoryRepository.create(database);
  const customGraphs = PrismaCustomGraphRepository.create(database);
  // The SAME suppression read a graph alert filters its recipients through: an
  // unsubscribe one half of this feature honoured and the other ignored is a
  // customer who unsubscribed and still gets mail.
  const graphDelivery = PostgresAutomationGraphDeliveryAdapter.create({ database, clock });

  const deps: ReportDispatchDeps = {
    findTrigger: ({ projectId, triggerId }) => triggers.findById({ triggerId, projectId }),
    findProject: (projectId) => input.projects.findById(projectId),
    delivery: input.delivery,
    slackProvider: AutomationSlackSecretsService.create(input.crypto),
    filterSuppressedRecipients: (suppressed) => graphDelivery.filterSuppressed(suppressed),
    listReportTraces: (traces) => input.listReportTraces(traces),
    loadReportCharts: ({ projectId, source, from, to }) =>
      ReportChartService.loadReportCharts({
        deps: {
          findCustomGraph: ({ projectId: project, customGraphId }) =>
            customGraphs.findById({ customGraphId, projectId: project }),
          loadDashboardGraphs: ({ projectId: project, dashboardId }) =>
            customGraphs.findAllByDashboardId({ dashboardId, projectId: project }),
          getTimeseries: (timeseries) => input.getTimeseries(timeseries),
        },
        source,
        projectId,
        from,
        to,
      }),
    // A report's fire is a completed EVENT, not an open incident, so
    // `resolvedAt` is stamped at write time. The automations list reads
    // "currently firing" as `customGraphId != null AND resolvedAt IS NULL`, so
    // a report row can never masquerade as a live alert.
    recordFire: async ({ projectId, triggerId, firedAt }) => {
      await fires.create({
        projectId,
        triggerId,
        traceId: null,
        customGraphId: null,
        createdAt: firedAt,
        resolvedAt: firedAt,
      });
    },
    baseHost: input.baseHost,
  };

  return {
    schedules: ReportScheduleService.create({
      jobs: input.jobs,
      clock,
      wake: input.wake,
      triggers,
    }),
    dispatchScheduledReport: (fire) =>
      ReportDispatchService.dispatchScheduledReport({ deps, fire }),
    toReportTraceRow: (row) => ReportTraceRowService.toReportTraceRow(row),
  };
}

/** Every table this feature's settlement half reads or writes. */
export type AutomationSettlementDatabase = AutomationSettlementLedgerDatabase &
  TriggerDatabase &
  GraphTriggerSentDatabase &
  WebhookDeliveryDatabase;

/**
 * Where the daily persist ceiling comes from: a number this deployment stated,
 * or the plan a project's organization is actually on.
 */
export type AutomationPersistCeiling =
  | Readonly<{ kind: "fixed"; cap: number }>
  | Readonly<{
      kind: "plan";
      projects: ProjectApi;
      plans: EntitlementApi;
      free: number;
      paid: number;
      enterprise: number;
    }>;

/** Everything containment reads, once the ledger it filters through exists. */
export type AutomationRunawayCollaborator = AutomationRunaway &
  AutomationRunawayNotice &
  AutomationRunawaySignals;

/**
 * This feature's settlement half, as the composing process's pipeline mounts it.
 */
export type AutomationSettlement = Readonly<{
  /** What a settled intent is carried out by. */
  settlement: AutomationSettlementExecutor;
  /** The two schedules the pipeline drives, and the graph re-check one reaches. */
  scheduledIntents: AutomationScheduledIntent;
}>;

/**
 * Settlement, composed over substrates the process owns. Containment
 * shares the ledger's suppression rows with a digest, so the runaway
 * collaborator arrives as a callback, keeping that table to one reader.
 */
export function createAutomationSettlement(input: {
  /** The one database client the composing process opened. */
  prisma: AutomationSettlementDatabase;
  clock: AutomationClock;
  /** Where the daily ceiling counts: a Redis one counts fleet-wide. */
  persistCapSlots: AutomationPersistCapRepository;
  projects: AutomationProjectDirectory;
  traces: AutomationSettlementTraceReader;
  evaluations: AutomationSettlementEvaluationReader;
  /** How a saved automation's own filters are re-checked against the trace it matched. */
  filterEvaluator: AutomationSettlementFilterEvaluator;
  /** `ADD_TO_DATASET`'s row mapping, and the two persist writes. */
  mapper: AutomationDatasetMapper;
  writer: AutomationPersistActionWriter;
  /**
   * The process's outbound transports, the ceilings they spend, and the cipher
   * they read secrets with.
   */
  delivery: AutomationNotificationDelivery;
  emailCaps: AutomationEmailCapService;
  crypto: AutomationSecretCrypto;
  /** The deployment's own origin; every link in a digest is built from it. */
  baseHost: string;
  observability: AutomationSettlementObservability;
  /**
   * What this process does about an automation past its ceiling when it
   * composed no containment.
   */
  breach: AutomationSettlementBreach;
  /** Reads the recency the heartbeat sweep decides absence from. */
  analytics: Pick<AnalyticsApi, "findLastOccurredAt">;
  logger: AutomationLogger;
  /** The graph half, when this process composed one. */
  graphActivity?: AutomationGraphActivity | undefined;
  persistCeiling: AutomationPersistCeiling;
  emailHourlyCap: number;
  tenantDailyCap: number;
  /**
   * Builds containment over the suppression rows the ledger owns. Absent leaves
   * a breach logged and nobody notified, which is what a process with no
   * outbound mail or no tenancy can honestly do.
   */
  createRunaway?:
    | ((suppression: AutomationSettlementLedgerService) => AutomationRunawayCollaborator)
    | undefined;
}): AutomationSettlement {
  const { prisma, clock } = input;
  // The ceiling's tier, resolved through this feature's own cap service so that
  // the hop from project to organization, the contract override and the
  // ten-minute cache are the ones the interactive process uses. Only the
  // resolution is taken: the COUNTING stays on the ledger's shared slot, and two
  // services counting the same slot would give one fleet two tallies.
  const persistCaps =
    input.persistCeiling.kind === "plan"
      ? AutomationPersistCapService.create({
          projects: input.persistCeiling.projects,
          planProvider: input.persistCeiling.plans,
          slots: input.persistCapSlots,
          config: {
            free: input.persistCeiling.free,
            paid: input.persistCeiling.paid,
            enterprise: input.persistCeiling.enterprise,
          },
        })
      : undefined;

  let containment: RunawayContainmentService | undefined;
  const ledger = PrismaAutomationSettlementLedgerRepository.create({
    prisma,
    clock,
    persistCaps: input.persistCapSlots,
    persistCap: persistCaps
      ? { kind: "resolved", resolve: (projectId) => persistCaps.resolvePersistDailyCap(projectId) }
      : { kind: "fixed", cap: statedCeiling(input.persistCeiling) },
    breach: new LateContainmentBreach(input.breach, () => containment),
  });

  const createRunaway = input.createRunaway;
  if (createRunaway) {
    containment = RunawayContainmentService.create({
      runaway: createRunaway(ledger),
      triggers: PrismaTriggerRepository.create(prisma, clock),
      clock,
    });
  }

  return {
    settlement: AutomationSettlementDispatchService.create({
      automation: ledger,
      projects: input.projects,
      traces: input.traces,
      baseHost: input.baseHost,
      confirmation: AutomationSettlementMatchConfirmationService.create({
        evaluations: input.evaluations,
        traces: input.traces,
        filterEvaluator: input.filterEvaluator,
      }),
      persistActions: AutomationPersistActionService.create({
        automation: ledger,
        projects: input.projects,
        traces: input.traces,
        mapper: input.mapper,
        writer: input.writer,
      }),
      delivery: input.delivery,
      emailCaps: input.emailCaps,
      slack: AutomationSlackSecretsService.create(input.crypto),
      webhooks: AutomationWebhookSecretsService.create(input.crypto),
      clock,
      observability: input.observability,
      emailHourlyCap: input.emailHourlyCap,
      tenantDailyCap: input.tenantDailyCap,
    }),
    scheduledIntents: new ComposedScheduledIntents(
      GraphTriggerHeartbeatService.create({
        triggers: PrismaTriggerRepository.create(prisma, clock),
        triggerSent: PrismaGraphTriggerSentRepository.create(prisma),
        analytics: input.analytics,
        logger: input.logger,
      }),
      PrismaWebhookDeliveryRepository.create(prisma),
      input.graphActivity,
    ),
  };
}

/** The paid ceiling, stated rather than resolved. See the config leaf. */
function statedCeiling(ceiling: AutomationPersistCeiling): number {
  return ceiling.kind === "fixed" ? ceiling.cap : ceiling.paid;
}

/**
 * The breach handler, resolved LATE: containment reads suppression rows
 * off the ledger this port is handed to, so the thunk is the knot, not an
 * optional. Absent containment, this process's own report stands.
 */
class LateContainmentBreach extends AutomationSettlementBreach {
  constructor(
    private readonly reported: AutomationSettlementBreach,
    private readonly resolve: () => RunawayContainmentService | undefined,
  ) {
    super();
  }

  async handle(breach: Parameters<AutomationSettlementBreach["handle"]>[0]): Promise<void> {
    const containment = this.resolve();
    if (containment) return containment.handle(breach);

    return this.reported.handle(breach);
  }
}

/**
 * The two schedules, and the graph re-check one of them drives.
 */
class ComposedScheduledIntents extends AutomationScheduledIntent {
  constructor(
    private readonly heartbeat: GraphTriggerHeartbeatService,
    private readonly deliveries: { pruneExpired(now?: Instant): Promise<number> },
    private readonly graphActivity: AutomationGraphActivity | undefined,
  ) {
    super();
  }

  decideGraphTriggerHeartbeat(now: { now: Instant }): Promise<GraphTriggerSweepCandidate[]> {
    return this.heartbeat.decide(now);
  }

  evaluateGraphTrigger(candidate: {
    triggerId: string;
    projectId: string;
    reason: Parameters<AutomationGraphActivity["evaluateGraphTrigger"]>[0]["reason"];
  }): Promise<GraphTriggerEvaluationResult> {
    if (!this.graphActivity) {
      return Promise.reject(
        new DispatchError({
          message:
            "This process composes no graph-alert vertical, so a sweep candidate cannot be evaluated here. Set BASE_HOST to compose one.",
          retryable: false,
        }),
      );
    }

    return this.graphActivity.evaluateGraphTrigger(candidate);
  }

  pruneWebhookDeliveries(now?: Instant): Promise<number> {
    return this.deliveries.pruneExpired(now);
  }
}

/**
 * The durable automation rows a composing process writes through, each built here rather than by
 * naming the Prisma class: a process holds the client, the module holds the choice of what reads
 * and writes it (private-runtime-export drive, dev/docs/plans/private-runtime-export-drive.md §3d).
 */
export function createAutomationTriggers(
  database: TriggerDatabase,
  clock: AutomationClock,
): TriggerRepository {
  return PrismaTriggerRepository.create(database, clock);
}

/** The trigger-sent ledger a graph alert reads before it fires twice. */
export function createAutomationGraphTriggerSent(
  database: GraphTriggerSentDatabase,
): GraphTriggerSentRepository {
  return PrismaGraphTriggerSentRepository.create(database);
}

/** The webhook deliveries an automation records and later prunes. */
export function createAutomationWebhookDeliveries(
  database: WebhookDeliveryDatabase,
): WebhookDeliveryRepository {
  return PrismaWebhookDeliveryRepository.create(database);
}

/** The custom graphs a report schedule renders from. */
export function createAutomationCustomGraphs(database: CustomGraphDatabase): CustomGraphRepository {
  return PrismaCustomGraphRepository.create(database);
}

/** The settlement ledger, over the daily ceiling this deployment enforces. */
export function createAutomationSettlementLedger(
  options: Parameters<typeof PrismaAutomationSettlementLedgerRepository.create>[0],
): AutomationSettlementLedger {
  return PrismaAutomationSettlementLedgerRepository.create(options);
}

/** The trace triggers an ingested trace is matched against. */
export function createAutomationTraceTriggerCatalogue(input: {
  prisma: AutomationTraceTriggerCatalogueDatabase;
  clock: AutomationClock;
}): AutomationTraceTriggerCatalogue {
  return PrismaAutomationTraceTriggerCatalogueRepository.create(input);
}
