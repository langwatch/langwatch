import { AnalyticsApi } from "@langwatch/analytics-contract";
import { AnnotationApi } from "@langwatch/annotation-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
/**
 * The automation feature's application: the one typed thing all five of its
 * doors are given, so one operation serves a browser, an API key and a job.
 * @see adrs/001-automation-service-boundary.md
 */
import {
  automationServerConfig,
  AutomationApi as AutomationApiToken,
  InvalidUnsubscribeTokenError,
  UnsubscribeLinkInvalidError,
  UnsubscribeRateLimitedError,
  type AutomationApi,
  type AutomationApiCreateInput,
  type AutomationApiListSlackChannelsInput,
  type AutomationApiTestFireInput,
  type AutomationApiToggleTriggerInput,
  type AutomationApiUpdateTriggerFiltersInput,
  type AutomationApiUpsertInput,
  type AutomationApiFireHistoryInput,
  type AutomationApiTriggerScope,
  type NextFiring,
  type TriggerLatestEvaluation,
  type AutomationRestCreateInput,
  type AutomationRestUpdateInput,
  type TriggerFirePage,
  type AutomationAction,
  type AutomationAuthor,
  type AutomationTestFireAuthor,
  type UnsubscribeChannel,
  type AutomationListRow,
  type AutomationPersistCapCount,
  type AutomationServerConfig,
  type CreateTriggerCommand,
  type CustomGraphNameRef,
  type EmailSuppression,
  type EmailSuppressionRow,
  type OperatorReportSchedule,
  type ReportSchedule,
  type SlackChannelListing,
  type TestFireInput,
  type TestFireResult,
  type TestFireTemplateDraft,
  type Trigger,
  type TriggerFire,
  type TriggerFireStats,
  type UnsubscribeView,
  type UpdateTriggerCommand,
  type WebhookDeliveryRow,
  type AutomationUsageCount,
} from "@langwatch/automation-contract";
import { DatasetApi } from "@langwatch/dataset-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { EvaluationApi } from "@langwatch/evaluation-contract";
import { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { EventingCommands, ProcessStore } from "@langwatch/eventing";
import { ReactEmailMailRenderer } from "@langwatch/mail";
import type { ResolvedTokens } from "@langwatch/module";
import {
  MonitorApi,
  type Monitor,
  type MonitorApi as MonitorApiContract,
} from "@langwatch/monitor-contract";
import { NotificationService } from "@langwatch/notification-contract";
import { createLogger } from "@langwatch/observability";
import type { FeatureSetup } from "@langwatch/process";
import type { Encryption } from "@langwatch/process-stores/members";
import { ProjectApi } from "@langwatch/project-contract";
import { sessionSecret } from "@langwatch/secrets";
import { SlackApi } from "@langwatch/slack-contract";
import type { SystemMigration } from "@langwatch/system-migrations";
import { nowInstant, type Instant } from "@langwatch/time";
import { TraceApi } from "@langwatch/trace-contract";
import { WebhookApi } from "@langwatch/webhook-contract";

import type { AutomationGraphNotifier } from "../channels/automation-graph-alert.channel.ts";
import type { AutomationNotificationDelivery } from "../channels/automation-notification-delivery.channel.ts";
import type { AutomationRunawayNotice } from "../channels/automation-runaway-notice.channel.ts";
import type { AutomationTestFire } from "../channels/automation-test-fire.channel.ts";
import {
  createAutomationsPipeline,
  type AutomationsPipeline,
} from "../eventing/automation.pipeline.ts";
import type { AutomationScheduledIntent } from "../eventing/graph-alert-sweep.intent.ts";
import type { ReportDispatcher } from "../eventing/report-schedule.intent.ts";
import type { AutomationSettlementExecutor } from "../eventing/trigger-settlement.intent.ts";
import { SlackConnectionMigration } from "../migrations/legacy-import.slack-connection.migration.ts";
import type { AutomationPersistCapRepository } from "../repositories/automation-persist-cap.repository.ts";
import type { AutomationRunawayRepository } from "../repositories/automation-runaway.repository.ts";
import type {
  AutomationRepositories,
  AutomationClock,
} from "../repositories/automation.repositories.ts";
import { MemoryAutomationEmailCapRepository } from "../repositories/memory/memory.automation-email-cap.repository.ts";
import { automationPlatformUrl } from "../rules/automation-platform-url.rules.ts";
import { AutomationAuditSinkService } from "../services/automation-audit-sink.service.ts";
import { AutomationAuthoringService } from "../services/automation-authoring.service.ts";
import { AutomationDispatchErrorsTerminalService } from "../services/automation-dispatch-errors-terminal.service.ts";
import { AutomationEvaluationSubscriberService } from "../services/automation-evaluation-subscriber.service.ts";
import { AutomationEvaluationTriggerFilterService } from "../services/automation-evaluation-trigger-filter.service.ts";
import type { AutomationDispatchError } from "../services/automation-graph-activity.service.ts";
import { AutomationGraphAlertNotifierService } from "../services/automation-graph-alert-notifier.service.ts";
import { AutomationMatchRecordMetricsService } from "../services/automation-match-record-metrics.service.ts";
import { AutomationNotificationDeliveryUnavailableService } from "../services/automation-notification-delivery-unavailable.service.ts";
import { AutomationNotificationDeliveryService } from "../services/automation-notification-delivery.service.ts";
import { AutomationProviderRegistryService } from "../services/automation-provider-registry.service.ts";
import { AutomationPublicApiService } from "../services/automation-public-api.service.ts";
import {
  AutomationRulesService,
  type AutomationProjectIdentity,
} from "../services/automation-rules.service.ts";
import { AutomationRunawayMetricsOtelService } from "../services/automation-runaway-metrics-otel.service.ts";
import { AutomationRunawayUncontainedService } from "../services/automation-runaway-uncontained.service.ts";
import { AutomationRunawayService } from "../services/automation-runaway.service.ts";
import { AutomationScheduledIntentsService } from "../services/automation-scheduled-intents.service.ts";
import { AutomationSettlementBreachLateService } from "../services/automation-settlement-breach-late.service.ts";
import { AutomationSettlementBreachLoggedService } from "../services/automation-settlement-breach-logged.service.ts";
import { AutomationSettlementLedgerService } from "../services/automation-settlement-ledger.service.ts";
import { AutomationSettlementMatchConfirmationService } from "../services/automation-settlement-match-confirmation.service.ts";
import { AutomationSettlementObservabilityService } from "../services/automation-settlement-observability.service.ts";
import { AutomationSlackConnectionService } from "../services/automation-slack-connection.service.ts";
import { AutomationSlackDirectoryUnavailableService } from "../services/automation-slack-directory-unavailable.service.ts";
import { AutomationTemplateService } from "../services/automation-template.service.ts";
import { AutomationTestFireService } from "../services/automation-test-fire.service.ts";
import { AutomationTraceFilterCompilerService } from "../services/automation-trace-filter-compiler.service.ts";
import { AutomationTraceTriggerCatalogueService } from "../services/automation-trace-trigger-catalogue.service.ts";
import { AutomationTriggerMatchDispatcherService } from "../services/automation-trigger-match-dispatcher.service.ts";
import {
  type AutomationWebhookStoredParams,
  AutomationWebhookSecretsService,
} from "../services/automation-webhook-secrets.service.ts";
import { AutomationService, type AutomationLogger } from "../services/automation.service.ts";
import { DatasetTraceMapperService } from "../services/dataset-trace-mapper.service.ts";
import { AutomationEmailCapService } from "../services/email-cap.service.ts";
import { GraphTriggerHeartbeatService } from "../services/graph-trigger-heartbeat.service.ts";
import { PersistActionWriterService } from "../services/persist-action-writer.service.ts";
import { AutomationPersistActionService } from "../services/persist-action.service.ts";
import { AutomationPersistCapService } from "../services/persist-cap.service.ts";
import { ReportDispatcherService } from "../services/report-dispatcher.service.ts";
import { ReportScheduleService } from "../services/report-schedule.service.ts";
import {
  RunawayContainmentService,
  type AutomationRunawaySignals,
} from "../services/runaway-containment.service.ts";
import { SlackConnectionMigrationService } from "../services/slack-connection-migration.service.ts";
import { SlackDestinationService } from "../services/slack-destination.service.ts";
import { TriggerFilterValidationService } from "../services/trigger-filter-validation.service.ts";
import { AutomationGraphService } from "../services/trigger-graph.service.ts";
import { TriggerLatestEvaluationService } from "../services/trigger-latest-evaluation.service.ts";
import { AutomationSettlementDispatchService } from "../services/trigger-settlement-dispatch.service.ts";
import {
  HmacUnsubscribeTokenAdapter,
  type UnsubscribeTokenVerifier,
} from "../services/unsubscribe-token.service.ts";

const logger = createLogger("langwatch:automation");

export type { AutomationWebhookStoredParams };
export type { AutomationProjectIdentity };

// ---------------------------------------------------------------------------
// The technical members the process supplies: a cipher, an HTTP client, a
// query compiler, a counter and an audit ledger, all owned by the deployment.
// ---------------------------------------------------------------------------

/**
 * One `safeParse` outcome, described structurally rather than as a zod type:
 * the schema comes from the process's provider registry, which is compiled
 * against its own copy of zod.
 */
export type AutomationActionParamsParse =
  | Readonly<{ success: true; data: unknown }>
  | Readonly<{
      success: false;
      error: Readonly<{ issues: readonly Readonly<{ message: string }>[] }>;
    }>;

/** The per-action `actionParams` parser the process's provider registry owns. */
export interface AutomationActionParamsSchema {
  safeParse(value: unknown): AutomationActionParamsParse;
}

/** Every automation channel's at-rest secret handling, bound to one cipher. */
export interface AutomationProviderSecrets {
  /** The authoritative `actionParams` shape for one action. */
  actionParamsSchemaFor(action: AutomationAction): AutomationActionParamsSchema;
  /**
   * Wire params in their at-rest shape: secrets encrypted, kept sentinels
   * resolved against the saved row. Throws `HandledError` subclasses for the
   * author-facing failures.
   */
  persistActionParamsFor(
    action: AutomationAction,
    args: Readonly<{ incoming: Record<string, unknown>; loadExisting: () => Promise<unknown> }>,
  ): Promise<unknown>;
  /** Stored params with every secret stripped, for a row on its way out. */
  redactActionParamsFor(action: AutomationAction, params: unknown): unknown;
  /** The stored webhook header values in the clear, by header name. */
  decryptWebhookHeaders(stored: AutomationWebhookStoredParams): Record<string, string>;
  /** The stored webhook signing secrets in the clear, newest first. */
  decryptWebhookSigningSecrets(stored: AutomationWebhookStoredParams): readonly string[];
}

/**
 * The Slack conversations a bot token can see, through the process's own
 * SSRF-checked HTTP client.
 */
export interface AutomationSlackDirectory {
  list(token: string): Promise<SlackChannelListing>;
}

/**
 * Compiles a trace-filter query, throwing when it cannot be parsed. A dry run:
 * an unparseable query is refused with author feedback here rather than failing
 * closed - matching nothing - at dispatch time.
 */
export interface AutomationTraceFilterCompiler {
  assertCompiles(input: Readonly<{ query: string; projectId: string }>): void;
}

/**
 * The process's per-key fixed-window counter. Hygiene on the test-fire button,
 * the outbound-flood cap on the webhook channel (ADR-040 §4) and the throttle
 * on the unauthenticated unsubscribe pair (ADR-031).
 */
export interface AutomationCallCounter {
  count(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
}

/** Where a read of customer email addresses is written down. */
export interface AutomationAuditSink {
  record(
    entry: Readonly<{
      userId: string;
      projectId?: string;
      action: string;
      args?: unknown;
    }>,
  ): Promise<void>;
}

export type AutomationInfrastructure = Readonly<{
  verifier: UnsubscribeTokenVerifier;
  clock: AutomationClock;
  notifier: AutomationGraphNotifier;
  logger: AutomationLogger;
  slackDestinations: SlackDestinationService;
  /** Points a Slack save at a connection and moves its claim (ARCHITECTURE.md §3). */
  slackConnections: AutomationSlackConnectionService;
  dispatchErrors: AutomationDispatchError;
  runaway: AutomationRunawayRepository & AutomationRunawayNotice & AutomationRunawaySignals;
  testFire: AutomationTestFire;
  persistCaps: AutomationPersistCapRepository;
  providers: AutomationProviderSecrets;
  slackChannels: AutomationSlackDirectory;
  traceFilters: AutomationTraceFilterCompiler;
  limits: AutomationCallCounter;
  audit: AutomationAuditSink;
  /** The deployment's public origin, for `platformUrl`. Optional: not every install serves REST. */
  publicBaseUrl?: string;
  // Peer APIs are resolved from setup.dependencies; members contains technical ports only.
}>;

/** What `AutomationModule.create` reads off process members. */
type AutomationProcessMembers = Readonly<{
  encryption: Encryption;
  publicBaseUrl: string | undefined;
}>;

type AutomationInfrastructureInput = Readonly<{
  /** Reads and writes the Slack bot tokens and webhook secrets this deployment stores. */
  crypto: Encryption;
  /** The deployment's public origin; absent, nothing this process sends can link back. */
  publicBaseUrl: string | undefined;
  slackDestinations: SlackDestinationService;
  slackConnections: AutomationSlackConnectionService;
  notifications: Pick<NotificationService, "sendEmail" | "getMailDelivery">;
  webhooks: Pick<WebhookApi, "sendRequest">;
  traces: Pick<TraceApi, "translateTraceFilter">;
  auditLog: AuditLogApi;
  verifier: UnsubscribeTokenVerifier;
  /** The key the verifier checks with, so every link this process mails verifies. */
  unsubscribeSigningSecret: string | undefined;
  repositories: Pick<
    AutomationRepositories,
    "triggers" | "suppressions" | "persistCaps" | "callCounter" | "emailCaps"
  >;
  caps: Readonly<{ emailHourlyCap: number; tenantDailyCap: number }>;
}>;

/** What settlement sends through: the SAME delivery and ceilings graph alerts spend. */
type AutomationComposedInfrastructure = AutomationInfrastructure &
  Readonly<{
    crypto: Encryption;
    delivery: AutomationNotificationDelivery;
    emailCaps: AutomationEmailCapService;
  }>;

/** This feature's settlement half, as the pipeline mounts it. */
type AutomationSettlement = Readonly<{
  settlement: AutomationSettlementExecutor;
  scheduledIntents: AutomationScheduledIntent;
}>;

/** How often the unauthenticated unsubscribe pair may be asked, per caller. */
const UNSUBSCRIBE_WINDOW_SECONDS = 60;
const UNSUBSCRIBE_RESOLVE_MAX = 30;
const UNSUBSCRIBE_CONFIRM_MAX = 10;

type AutomationDependencies = Readonly<{
  analytics: typeof AnalyticsApi;
  monitors: typeof MonitorApi;
  /** Whether an id a condition keys by is an evaluator's, which a condition cannot select by. */
  evaluators: typeof EvaluatorApi;
  entitlement: typeof EntitlementApi;
  projects: typeof ProjectApi;
  /** The SAME trail every other completed mutation on this process is recorded on. */
  auditLog: typeof AuditLogApi;
  /** The trace summary an evaluation match is confirmed against, and how its query is read. */
  traces: typeof TraceApi;
  /** Settlement's peers: evaluation runs a match is re-checked on, and the two persist writes. */
  evaluations: typeof EvaluationApi;
  datasets: typeof DatasetApi;
  annotations: typeof AnnotationApi;
  /** Who a runaway automation's limit notice reaches: its organization's administrators. */
  authorization: typeof AuthzApi;
  /** Where every mail automation sends goes out; notification writes the envelope. */
  notifications: typeof NotificationService;
  /** The Slack connections a Slack automation delivers through and claims. */
  slack: typeof SlackApi;
  /** Where a webhook action's attempt is sent and logged; webhook owns the log (ADR-167). */
  webhooks: typeof WebhookApi;
}>;

/** Peers only `create` composes (settlement's and mail's); `fromInfrastructure` never sees them. */
type AutomationSettlementPeer =
  | "datasets"
  | "annotations"
  | "authorization"
  | "notifications"
  | "slack";

/** {@link AutomationDependencies}, resolved to the peer Apps `fromInfrastructure` itself reads. */
type AutomationRuntimeDependencies = Omit<
  ResolvedTokens<AutomationDependencies>,
  AutomationSettlementPeer
>;

type AutomationSetup = FeatureSetup<
  AutomationDependencies,
  AutomationProcessMembers,
  AutomationServerConfig
> &
  Readonly<{ repositories: AutomationRepositories }>;

/** What the application is composed from, once the process has supplied it. */
interface AutomationAppCollaborators {
  automation: AutomationService;
  monitors: MonitorApiContract;
  rules: AutomationRulesService;
  authoring: AutomationAuthoringService;
  publicApi: AutomationPublicApiService;
  latestEvaluations: TriggerLatestEvaluationService;
  audit: AutomationAuditSink;
  limits: AutomationCallCounter;
  publicBaseUrl: string | undefined;
  evaluations: AutomationEvaluationSubscriberService;
  triggerMatches: AutomationTriggerMatchDispatcherService;
  reportSchedules: ReportScheduleService;
  settlement: AutomationSettlement | undefined;
}

export class AutomationModule implements AutomationApi {
  static readonly contract = AutomationApiToken;
  static readonly dependencies = {
    analytics: AnalyticsApi,
    monitors: MonitorApi,
    evaluators: EvaluatorApi,
    entitlement: EntitlementApi,
    projects: ProjectApi,
    auditLog: AuditLogApi,
    traces: TraceApi,
    evaluations: EvaluationApi,
    datasets: DatasetApi,
    annotations: AnnotationApi,
    authorization: AuthzApi,
    /** Where every mail automation sends goes out; notification owns the gateway. */
    notifications: NotificationService,
    /** The Slack connections a Slack automation delivers through and claims. */
    slack: SlackApi,
    /** Sends and logs each webhook action attempt (ADR-167). */
    webhooks: WebhookApi,
  };
  static readonly config = automationServerConfig;
  /** Unsubscribe links are signed with auth's session key, as main signed them (§6). */
  static readonly secrets = { unsubscribe: sessionSecret } as const;
  static readonly reads = ["encryption", "publicBaseUrl"] as const;

  /**
   * Builds this process's own {@link AutomationInfrastructure} from the
   * members it reads and its own config, then composes exactly as
   * {@link AutomationModule.fromInfrastructure} does.
   */
  static create(setup: AutomationSetup): Promise<AutomationModule> {
    return setup.secrets.into(AutomationModule.secrets.unsubscribe, (unsubscribeSigningSecret) => {
      const { slack, projects } = setup.dependencies;
      const { encryption: crypto, publicBaseUrl } = setup.members;
      const slackConnections = AutomationSlackConnectionService.create({ slack, projects, crypto });
      const infrastructure = AutomationModule.#composeInfrastructure({
        crypto,
        publicBaseUrl,
        slackDestinations: SlackDestinationService.create({ slack, crypto }),
        slackConnections,
        notifications: setup.dependencies.notifications,
        webhooks: setup.dependencies.webhooks,
        traces: setup.dependencies.traces,
        auditLog: setup.dependencies.auditLog,
        verifier: HmacUnsubscribeTokenAdapter.create({ secret: unsubscribeSigningSecret }),
        unsubscribeSigningSecret,
        repositories: setup.repositories,
        caps: {
          emailHourlyCap: setup.config.emailHourlyCap,
          tenantDailyCap: setup.config.tenantDailyCap,
        },
      });
      const automation = AutomationModule.fromInfrastructure({
        infrastructure,
        dependencies: setup.dependencies,
        repositories: setup.repositories,
        config: setup.config,
      });
      automation.#settlement = AutomationModule.#composeSettlement(
        setup,
        infrastructure,
        automation,
      );
      automation.#reportDispatcher = ReportDispatcherService.create({
        repositories: setup.repositories,
        projects: setup.dependencies.projects,
        analytics: setup.dependencies.analytics,
        traces: setup.dependencies.traces,
        delivery: infrastructure.delivery,
        slackDestinations: infrastructure.slackDestinations,
        suppression: automation.#automation,
        baseHost: publicBaseUrl ?? "",
      });
      automation.#migration = SlackConnectionMigration.create({
        pass: SlackConnectionMigrationService.create({
          triggers: setup.repositories.triggers,
          projects,
          slack,
          slackConnections,
          crypto,
        }),
      });
      return automation;
    });
  }

  /** The graph-alert delivery a re-evaluation dispatches through (mail, Slack, webhook). */
  static #composeInfrastructure(
    input: AutomationInfrastructureInput,
  ): AutomationComposedInfrastructure {
    const { crypto, publicBaseUrl } = input;
    const providers = AutomationProviderRegistryService.create(crypto);
    const clock: AutomationClock = { now: () => nowInstant() };
    // No public origin, no delivery: a digest would link back to nowhere.
    const delivery: AutomationNotificationDelivery = publicBaseUrl
      ? AutomationNotificationDeliveryService.create({
          mailer: input.notifications,
          renderer: ReactEmailMailRenderer.create(),
          baseHost: publicBaseUrl,
          ...(input.unsubscribeSigningSecret === undefined
            ? {}
            : { unsubscribeSigningSecret: input.unsubscribeSigningSecret }),
          webhookTransport: input.webhooks,
          logger,
        })
      : AutomationNotificationDeliveryUnavailableService.create();
    const emailCaps = AutomationEmailCapService.create({
      store: input.repositories.emailCaps,
      fallback: MemoryAutomationEmailCapRepository.create(),
    });

    return {
      crypto,
      delivery,
      emailCaps,
      verifier: input.verifier,
      clock,
      notifier: AutomationGraphAlertNotifierService.create({
        publicBaseUrl,
        repositories: input.repositories,
        caps: input.caps,
        providers,
        clock,
        delivery,
        emailCaps,
      }),
      logger,
      slackDestinations: input.slackDestinations,
      slackConnections: input.slackConnections,
      dispatchErrors: AutomationDispatchErrorsTerminalService.create(),
      runaway: AutomationRunawayUncontainedService.create(logger),
      testFire: AutomationTestFireService.create({
        mail: input.notifications,
        delivery,
        webhooks: input.webhooks,
      }),
      persistCaps: input.repositories.persistCaps,
      providers,
      slackChannels: AutomationSlackDirectoryUnavailableService.create(),
      traceFilters: AutomationTraceFilterCompilerService.create({ traces: input.traces, logger }),
      limits: input.repositories.callCounter,
      audit: AutomationAuditSinkService.create(input.auditLog),
      publicBaseUrl,
    };
  }

  /**
   * Main's worker-automation-settlement.composition.ts, over peers instead of foreign tables.
   * Containment shares the ledger's suppression rows, so the breach resolves it late.
   */
  static #composeSettlement(
    setup: AutomationSetup,
    infrastructure: AutomationComposedInfrastructure,
    automation: AutomationModule,
  ): AutomationSettlement {
    const { dependencies, config, repositories } = setup;
    const { clock } = infrastructure;
    const baseHost = infrastructure.publicBaseUrl ?? "";
    // Only the ceiling's tier is resolved here; the COUNTING stays on the ledger's shared slot.
    const persistCaps = AutomationPersistCapService.create({
      projects: dependencies.projects,
      planProvider: dependencies.entitlement,
      slots: infrastructure.persistCaps,
      config: {
        free: config.persistDailyCapFree,
        paid: config.persistDailyCapPaid,
        enterprise: config.persistDailyCapEnterprise,
      },
    });
    let containment: RunawayContainmentService | undefined;
    const ledger = AutomationSettlementLedgerService.create({
      triggers: repositories.triggers,
      suppressions: repositories.suppressions,
      clock,
      persistCaps: infrastructure.persistCaps,
      persistCap: {
        kind: "resolved",
        resolve: (projectId) => persistCaps.resolvePersistDailyCap(projectId),
      },
      breach: AutomationSettlementBreachLateService.create({
        reported: AutomationSettlementBreachLoggedService.create(logger),
        resolve: () => containment,
      }),
    });
    containment = RunawayContainmentService.create({
      runaway: AutomationRunawayService.create({
        claims: repositories.containmentClaims,
        directories: {
          projects: dependencies.projects,
          authorization: dependencies.authorization,
        },
        suppression: ledger,
        mailer: { send: (content) => dependencies.notifications.sendEmail(content) },
        traces: dependencies.traces,
        metrics: AutomationRunawayMetricsOtelService.create(),
        baseHost,
        logger,
      }),
      triggers: repositories.triggers,
      clock,
      slackConnections: infrastructure.slackConnections,
    });

    return {
      settlement: AutomationSettlementDispatchService.create({
        automation: ledger,
        projects: dependencies.projects,
        traces: dependencies.traces,
        baseHost,
        confirmation: AutomationSettlementMatchConfirmationService.create({
          evaluations: dependencies.evaluations,
          traces: dependencies.traces,
          traceFilters: dependencies.traces,
          evaluationFilters: dependencies.evaluations,
        }),
        persistActions: AutomationPersistActionService.create({
          automation: ledger,
          projects: dependencies.projects,
          traces: dependencies.traces,
          mapper: DatasetTraceMapperService.create(),
          writer: PersistActionWriterService.create({
            datasets: dependencies.datasets,
            annotations: dependencies.annotations,
          }),
        }),
        delivery: infrastructure.delivery,
        emailCaps: infrastructure.emailCaps,
        slackDestinations: infrastructure.slackDestinations,
        webhooks: AutomationWebhookSecretsService.create(infrastructure.crypto),
        clock,
        observability: AutomationSettlementObservabilityService.create({
          capture: (error, extra) =>
            logger.error(
              { ...extra, error: error.message },
              "Automation settlement dispatch failed",
            ),
        }),
        emailHourlyCap: config.emailHourlyCap,
        tenantDailyCap: config.tenantDailyCap,
      }),
      scheduledIntents: AutomationScheduledIntentsService.create({
        heartbeat: GraphTriggerHeartbeatService.create({
          triggers: repositories.triggers,
          triggerSent: repositories.graphTriggerSent,
          analytics: dependencies.analytics,
          logger,
        }),
        graphActivity: automation.#automation,
      }),
    };
  }

  /**
   * Composes over an already-built {@link AutomationInfrastructure}. Kept
   * because a hand composition (and every unit test's fixture) still builds
   * one directly rather than reading process members.
   */
  static fromInfrastructure(setup: {
    infrastructure: AutomationInfrastructure;
    dependencies: AutomationRuntimeDependencies;
    repositories: AutomationRepositories;
    config: AutomationServerConfig;
  }): AutomationModule {
    const { infrastructure, dependencies, repositories, config } = setup;

    const persistCaps = AutomationPersistCapService.create({
      projects: dependencies.projects,
      planProvider: dependencies.entitlement,
      config: {
        free: config.persistDailyCapFree,
        paid: config.persistDailyCapPaid,
        enterprise: config.persistDailyCapEnterprise,
      },
      slots: infrastructure.persistCaps,
    });
    const latestEvaluations = TriggerLatestEvaluationService.create({
      repository: repositories.latestEvaluations,
      logger: infrastructure.logger,
    });
    const graph = AutomationGraphService.create({
      triggers: repositories.triggers,
      customGraphs: repositories.customGraphs,
      projects: dependencies.projects,
      analytics: dependencies.analytics,
      notifier: infrastructure.notifier,
      triggerSent: repositories.graphTriggerSent,
      logger: infrastructure.logger,
      slackDestinations: infrastructure.slackDestinations,
      slackConnections: infrastructure.slackConnections,
      dispatchErrors: infrastructure.dispatchErrors,
      latestEvaluations,
      runaway: infrastructure.runaway,
      clock: infrastructure.clock,
      baseHost: infrastructure.publicBaseUrl ?? "",
    });
    const reportSchedules = ReportScheduleService.create({
      clock: infrastructure.clock,
      triggers: repositories.triggers,
      instances: repositories.processStore,
    });
    const automation = AutomationService.create({
      triggers: repositories.triggers,
      history: repositories.history,
      suppressions: repositories.suppressions,
      names: repositories.names,
      customGraphs: repositories.customGraphs,
      webhookDeliveries: dependencies.webhooks,
      verifier: infrastructure.verifier,
      reportSchedules,
      clock: infrastructure.clock,
      graph,
      templates: AutomationTemplateService.create({
        baseHost: infrastructure.publicBaseUrl ?? "",
        delivery: infrastructure.testFire,
      }),
      persistCaps,
      slackConnections: infrastructure.slackConnections,
    });
    const rules = AutomationRulesService.create({
      automation,
      projects: dependencies.projects,
    });

    const triggerMatches = AutomationTriggerMatchDispatcherService.create();
    const filterValidation = TriggerFilterValidationService.create({
      evaluators: dependencies.evaluators,
      monitors: dependencies.monitors,
    });

    return new AutomationModule({
      automation,
      rules,
      authoring: AutomationAuthoringService.create({
        automation,
        rules,
        monitors: dependencies.monitors,
        providers: infrastructure.providers,
        slackChannels: infrastructure.slackChannels,
        slackDestinations: infrastructure.slackDestinations,
        slackConnections: infrastructure.slackConnections,
        traceFilters: infrastructure.traceFilters,
        limits: infrastructure.limits,
        filterValidation,
        logger: infrastructure.logger,
      }),
      publicApi: AutomationPublicApiService.create({
        automation,
        rules,
        providers: infrastructure.providers,
        slackConnections: infrastructure.slackConnections,
        slackDestinations: infrastructure.slackDestinations,
        filterValidation,
        history: repositories.history,
        traceFilters: infrastructure.traceFilters,
        limits: infrastructure.limits,
        logger: infrastructure.logger,
      }),
      latestEvaluations,
      monitors: dependencies.monitors,
      audit: infrastructure.audit,
      limits: infrastructure.limits,
      publicBaseUrl: infrastructure.publicBaseUrl,
      evaluations: AutomationEvaluationSubscriberService.create({
        triggers: AutomationTraceTriggerCatalogueService.create({
          triggers: repositories.triggers,
          clock: infrastructure.clock,
        }),
        graphActivity: automation,
        traces: dependencies.traces,
        evaluationFilters: AutomationEvaluationTriggerFilterService.create(dependencies.traces),
        triggerMatches,
        matchRecordMetrics: AutomationMatchRecordMetricsService.create(),
        runs: dependencies.evaluations,
      }),
      triggerMatches,
      reportSchedules,
      settlement: undefined,
    });
  }

  #automation: AutomationService;
  #migration: SlackConnectionMigration | undefined;
  #rules: AutomationRulesService;
  #authoring: AutomationAuthoringService;
  #publicApi: AutomationPublicApiService;
  readonly #latestEvaluations: TriggerLatestEvaluationService;
  #monitors: MonitorApiContract;
  #audit: AutomationAuditSink;
  #limits: AutomationCallCounter;
  readonly #publicBaseUrl: string | undefined;
  readonly #evaluations: AutomationEvaluationSubscriberService;
  readonly #triggerMatches: AutomationTriggerMatchDispatcherService;
  readonly #reportSchedules: ReportScheduleService;
  #settlement: AutomationSettlement | undefined;
  #reportDispatcher: ReportDispatcher | undefined;
  #reportInstances: Pick<ProcessStore, "findByRef"> | undefined;

  private constructor(collaborators: AutomationAppCollaborators) {
    this.#automation = collaborators.automation;
    this.#rules = collaborators.rules;
    this.#authoring = collaborators.authoring;
    this.#publicApi = collaborators.publicApi;
    this.#latestEvaluations = collaborators.latestEvaluations;
    this.#monitors = collaborators.monitors;
    this.#audit = collaborators.audit;
    this.#limits = collaborators.limits;
    this.#publicBaseUrl = collaborators.publicBaseUrl;
    this.#evaluations = collaborators.evaluations;
    this.#triggerMatches = collaborators.triggerMatches;
    this.#reportSchedules = collaborators.reportSchedules;
    this.#settlement = collaborators.settlement;
  }

  /** The `automations` pipeline, over the settlement {@link create} composed. */
  eventingPipeline({ processStore }: { processStore: ProcessStore }): AutomationsPipeline {
    if (!this.#settlement || !this.#reportDispatcher) {
      throw new Error("Automation was asked for its pipeline, but no settlement was composed");
    }
    this.#reportInstances = processStore;
    return createAutomationsPipeline({
      ...this.#settlement,
      retention: processStore,
      reports: this.#reportDispatcher,
      reportRuns: this.#reportSchedules,
      peerReactions: this.#evaluations,
    });
  }

  /** Binds the registered `automations` pipeline's own senders. */
  connectCommands(commands: EventingCommands<AutomationsPipeline>): void {
    this.#triggerMatches.connect(commands);
    this.#reportSchedules.connect({
      commands,
      ...(this.#reportInstances ? { instances: this.#reportInstances } : {}),
    });
  }

  /** Configures every active report that has no schedule process yet (the tasks backfill). */
  reconcileReportSchedules(): Promise<{ repaired: number }> {
    return this.#reportSchedules.reconcile();
  }

  // -- reads -----------------------------------------------------------------

  /** Every automation in the project, deleted rows excluded by the service. */
  getAllForProject(input: { projectId: string }): Promise<Trigger[]> {
    return this.#automation.getAllForProject(input);
  }

  /** Every automation the list renders, redacted and enriched. */
  listAutomations(input: { projectId: string }): Promise<AutomationListRow[]> {
    return this.#authoring.listRows(input);
  }

  /** One automation, or null when the project does not have it. */
  findById(input: { triggerId: string; projectId: string }): Promise<Trigger | null> {
    return this.#automation.findById(input);
  }

  /** One automation with every secret stripped, for a browser to read. */
  findRedactedById(input: { triggerId: string; projectId: string }): Promise<Trigger | null> {
    return this.#authoring.findRedactedById(input);
  }

  /** One LIVE automation, or null when the project does not have one. */
  findLiveById(input: { triggerId: string; projectId: string }): Promise<Trigger | null> {
    return this.#rules.findLiveById(input);
  }

  /** One live automation, refusing when the project does not have it. */
  getById(input: { triggerId: string; projectId: string }): Promise<Trigger> {
    return this.#rules.getById(input);
  }

  /** One automation by the custom graph it watches, or null. */
  findByCustomGraphId(input: {
    projectId: string;
    customGraphId: string;
  }): Promise<Trigger | null> {
    return this.#automation.findByCustomGraphId(input);
  }

  getByCustomGraphIds(input: { projectId: string; customGraphIds: string[] }): Promise<Trigger[]> {
    return this.#automation.getByCustomGraphIds(input);
  }

  /** Refuses a graph alert whose graph is not this project's. */
  assertCustomGraphInProject(input: { customGraphId: string; projectId: string }): Promise<void> {
    return this.#rules.assertCustomGraphInProject(input);
  }

  /** Whether a graph alert's graph exists in this project. */
  customGraphExistsInProject(input: {
    customGraphId: string;
    projectId: string;
  }): Promise<boolean> {
    return this.#automation.customGraphExistsInProject(input);
  }

  /** The names of the custom graphs a list of automations points at. */
  getCustomGraphNamesByIds(input: {
    customGraphIds: string[];
    projectId: string;
  }): Promise<CustomGraphNameRef[]> {
    return this.#automation.getCustomGraphNamesByIds(input);
  }

  /** The monitors an automation's conditions name. */
  getMonitorsByIds(input: { monitorIds: string[]; projectId: string }): Promise<Monitor[]> {
    return this.#monitors.getAllByIds(input);
  }

  /** The plan's daily ceiling on persist actions. */
  resolvePersistDailyCap(projectId: string): Promise<number> {
    return this.#automation.resolvePersistDailyCap(projectId);
  }

  /** Today's confirmed-match and skipped counts, per automation. */
  readPersistCapCounts(input: {
    projectId: string;
    triggerIds: readonly string[];
    now: Instant;
    cap: number;
  }): Promise<Record<string, AutomationPersistCapCount>> {
    return this.#automation.readPersistCapCounts(input);
  }

  /** The ceiling and what each automation has spent of it today. */
  readDailyCapStatus(input: {
    projectId: string;
  }): Promise<{ cap: number; counts: Record<string, AutomationPersistCapCount> }> {
    return this.#authoring.readDailyCapStatus(input);
  }

  /** How often each automation has fired. */
  getFireStats(input: { projectId: string }): Promise<TriggerFireStats[]> {
    return this.#automation.getFireStats(input);
  }

  /** The activity feed, for one automation or for the whole project. */
  getRecentFires(input: {
    projectId: string;
    triggerId?: string;
    limit: number;
  }): Promise<TriggerFire[]> {
    return this.#automation.getRecentFires(input);
  }

  /** The per-attempt webhook delivery log for one automation (ADR-040 §6). */
  getRecentWebhookDeliveries(input: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<WebhookDeliveryRow[]> {
    return this.#automation.getRecentWebhookDeliveries(input);
  }

  /** When each report next runs and last ran, as the scheduler knows it. */
  getReportSchedules(input: { projectId: string }): Promise<ReportSchedule[]> {
    return this.#automation.getReportSchedules(input);
  }

  registeredMigrations(): readonly SystemMigration[] {
    if (!this.#migration) {
      throw new Error(
        "This AutomationModule was composed from already-built services, so it holds no migration: " +
          "compose it through AutomationModule.create to answer its registered migrations.",
      );
    }
    return [this.#migration];
  }

  /** The Slack conversations a bot token can see, for the channel picker. */
  listSlackChannels(input: AutomationApiListSlackChannelsInput): Promise<SlackChannelListing> {
    return this.#authoring.listSlackChannels(input);
  }

  // -- writes ----------------------------------------------------------------

  /**
   * Stores a new automation. The service invalidates the project's dispatch
   * cache as part of the write, so nothing here has to remember to.
   */
  create(command: CreateTriggerCommand): Promise<Trigger> {
    return this.#automation.create(command);
  }

  /**
   * Stores a new TRACE automation, which must name a condition -- one with
   * none matches every trace forever. Graph alerts and reports are exempt
   * (a threshold and a schedule are their conditions) and use {@link create}.
   */
  async createTraceAutomation(command: CreateTriggerCommand): Promise<Trigger> {
    this.assertTraceConditionPresent(command.filters);

    return this.create(command);
  }

  /** The authoring surface's legacy create, with its per-action refusals. */
  createAutomation(input: AutomationApiCreateInput, author: AutomationAuthor): Promise<Trigger> {
    return this.#authoring.create({ input, author });
  }

  /** The authoring drawer's save: one row, whichever of the three kinds it is. */
  saveAutomation(input: AutomationApiUpsertInput, author: AutomationAuthor): Promise<Trigger> {
    return this.#authoring.save({ input, author });
  }

  /** Pausing and resuming, including the report's calendar entry. */
  setAutomationActive(input: AutomationApiToggleTriggerInput): Promise<Trigger> {
    return this.#authoring.setActive(input);
  }

  /** Replaces one automation's condition, keeping it from matching everything. */
  replaceAutomationFilters(input: AutomationApiUpdateTriggerFiltersInput): Promise<Trigger> {
    return this.#authoring.replaceFilters(input);
  }

  /** Updates an automation; delivery settings go through the save's persist hook. */
  update(command: UpdateTriggerCommand): Promise<Trigger> {
    return this.#authoring.update(command);
  }

  /**
   * Removes an automation: the soft delete AND the retirement of any
   * scheduled-report entry, always both. A calendar entry left behind keeps
   * waking the scheduler forever. Idempotent for one that was never a report.
   */
  getPublicTrigger(input: { projectId: string; triggerId: string }): Promise<Trigger> {
    return this.#publicApi.getRedactedById(input);
  }

  deletePublicTrigger(input: { projectId: string; triggerId: string }): Promise<void> {
    return this.#publicApi.deleteById(input);
  }

  createPublicTrigger(input: {
    projectId: string;
    actorId: string;
    input: AutomationRestCreateInput;
  }): Promise<Trigger> {
    return this.#publicApi.create(input);
  }

  updatePublicTrigger(input: {
    projectId: string;
    triggerId: string;
    actorId: string;
    input: AutomationRestUpdateInput;
  }): Promise<Trigger> {
    return this.#publicApi.update(input);
  }

  setPublicTriggerActive(input: {
    projectId: string;
    triggerId: string;
    active: boolean;
  }): Promise<Trigger> {
    return this.#publicApi.setActive(input);
  }

  getFireHistory(input: AutomationApiFireHistoryInput): Promise<TriggerFirePage> {
    return this.#publicApi.getFireHistory(input);
  }

  findLatestEvaluation(input: AutomationApiTriggerScope): Promise<TriggerLatestEvaluation[]> {
    return this.#latestEvaluations.findByTriggerId(input);
  }

  getNextFiring(input: AutomationApiTriggerScope): Promise<NextFiring> {
    return this.#automation.getNextFiring(input);
  }

  listFireHistoryPage(input: AutomationApiFireHistoryInput): Promise<TriggerFirePage> {
    return this.#automation.listFireHistoryPage(input);
  }

  testFireStoredTrigger(input: { projectId: string; triggerId: string }): Promise<TestFireResult> {
    return this.#publicApi.testFire(input);
  }

  async delete(input: { triggerId: string; projectId: string }): Promise<void> {
    await this.#automation.softDeleteById(input);
    await this.#automation.removeReportSchedule({
      projectId: input.projectId,
      triggerId: input.triggerId,
    });
  }

  softDeleteById(input: { triggerId: string; projectId: string }): Promise<Trigger> {
    return this.#automation.softDeleteById(input);
  }

  /** Puts one report on the calendar scheduler (ADR-044). */
  syncReportSchedule(input: {
    projectId: string;
    triggerId: string;
    cron: string;
    timezone: string;
  }): Promise<void> {
    return this.#automation.syncReportSchedule(input);
  }

  /** Retires one report's calendar entry. Idempotent. */
  removeReportSchedule(input: { projectId: string; triggerId: string }): Promise<void> {
    return this.#automation.removeReportSchedule(input);
  }

  /** Every live report's schedule across projects, for the operator scheduler. */
  findAllReportSchedules(): Promise<OperatorReportSchedule[]> {
    return this.#reportSchedules.findAllAcrossProjects();
  }

  /** An operator's pause or resume of one report's schedule. */
  setReportScheduleActive(input: {
    projectId: string;
    triggerId: string;
    active: boolean;
  }): Promise<void> {
    return this.#reportSchedules.setActive(input);
  }

  /** An operator's run-now: one extra send, the cadence unchanged. */
  requestReportRun(input: { projectId: string; triggerId: string }): Promise<void> {
    return this.#reportSchedules.requestRun(input);
  }

  /** An operator's release of a stale run; a run started since is left alone. */
  clearReportRun(input: {
    projectId: string;
    triggerId: string;
    requestId: string;
  }): Promise<void> {
    return this.#reportSchedules.settleRun({ ...input, outcome: "cleared" });
  }

  /** Flushes the project's dispatch cache. */
  invalidate(projectId: string): Promise<void> {
    return this.#automation.invalidate(projectId);
  }

  // -- rules -----------------------------------------------------------------

  /** Refuses a trace automation with no condition. */
  assertTraceConditionPresent(filters: Record<string, unknown> | undefined): void {
    this.#rules.assertTraceConditionPresent(filters);
  }

  /** Refuses an edit that would leave a trace automation matching everything. */
  assertConditionSurvivesEdit(input: {
    existing: Trigger;
    filters: Record<string, unknown> | undefined;
  }): void {
    this.#rules.assertConditionSurvivesEdit(input);
  }

  /** The template draft an author is about to save. Throws on a bad template. */
  validateTemplateDraft(draft: TestFireTemplateDraft): void {
    this.#automation.validateTemplateDraft(draft);
  }

  // -- the project an automation belongs to ----------------------------------

  /** The project's name and slug, as a rendered notification quotes them. */
  getProjectIdentity(projectId: string): Promise<AutomationProjectIdentity> {
    return this.#rules.getProjectIdentity(projectId);
  }

  // -- the test fire ---------------------------------------------------------

  /** Renders and delivers one test notification (ADR-031). */
  testFire(input: TestFireInput): Promise<TestFireResult> {
    return this.#automation.testFire(input);
  }

  /** The authoring drawer's test-fire button, throttled and self-addressed. */
  sendTestFire(
    input: AutomationApiTestFireInput,
    author: AutomationTestFireAuthor,
  ): Promise<TestFireResult> {
    return this.#authoring.testFire({ input, author });
  }

  // -- email suppression (ADR-031) -------------------------------------------

  /** The masked recipient and names behind an unsubscribe token, or null. */
  findUnsubscribeView(input: { token: string }): Promise<{
    projectName: string;
    triggerName: string | null;
    email: string;
  } | null> {
    return this.#automation.findUnsubscribeView(input);
  }

  /**
   * The unsubscribe page's own read, throttled per caller -- public, so it
   * is a target for brute-forcing tokens; an unknown caller falls back to a
   * shared bucket, since a missing address must still throttle, not bypass.
   */
  async resolveUnsubscribeView(input: {
    token: string;
    callerAddress: string | null;
  }): Promise<UnsubscribeView> {
    await this.#countUnsubscribe({
      action: "resolve",
      callerAddress: input.callerAddress,
      max: UNSUBSCRIBE_RESOLVE_MAX,
    });

    const view = await this.#automation.findUnsubscribeView({ token: input.token });

    if (!view) {
      throw new UnsubscribeLinkInvalidError(
        "This unsubscribe link is invalid or has expired.",
        404,
      );
    }

    return view;
  }

  /** Records the unsubscribe. Idempotent - the upsert collapses duplicates. */
  confirmUnsubscribe(input: { token: string; scope: "trigger" | "project" }): Promise<void> {
    return this.#automation.confirmUnsubscribe(input);
  }

  /**
   * The same confirmation from either affordance, throttled per caller. A
   * bad token is the recipient's problem; a persistence failure is ours and
   * is re-raised as-is, degrading to "unknown" plus a trace id.
   */
  async acceptUnsubscribe(input: {
    token: string;
    scope: "trigger" | "project";
    callerAddress: string | null;
    via: UnsubscribeChannel;
  }): Promise<void> {
    if (!input.token) {
      throw new UnsubscribeLinkInvalidError("This unsubscribe link has no token.", 400);
    }

    await this.#countUnsubscribe({
      action: input.via === "one-click" ? "one-click" : "confirm",
      callerAddress: input.callerAddress,
      max: UNSUBSCRIBE_CONFIRM_MAX,
    });

    try {
      await this.#automation.confirmUnsubscribe({ token: input.token, scope: input.scope });
    } catch (err) {
      if (err instanceof InvalidUnsubscribeTokenError) {
        throw new UnsubscribeLinkInvalidError("This unsubscribe link is invalid.", 400);
      }

      throw err;
    }
  }

  /** Every suppression in the project, each row with its automation's name. */
  getAllEnriched(input: {
    projectId: string;
  }): Promise<(EmailSuppression & { triggerName: string | null })[]> {
    return this.#automation.getAllEnriched(input);
  }

  /**
   * The operator-facing suppression list. Audited explicitly, not via the
   * mutation trail, because reading it means reading customer emails.
   */
  async listSuppressions(input: {
    projectId: string;
    actorId: string;
  }): Promise<EmailSuppressionRow[]> {
    const rows = await this.#automation.getAllEnriched({ projectId: input.projectId });

    void this.#audit.record({
      userId: input.actorId,
      projectId: input.projectId,
      action: "emailSuppression.getAll",
      args: {
        recordCount: rows.length,
        triggerIds: [
          ...new Set(rows.map((row) => row.triggerId).filter((id): id is string => id != null)),
        ],
      },
    });

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      triggerId: row.triggerId,
      triggerName: row.triggerName,
      reason: row.reason,
      createdAt: row.createdAt,
    }));
  }

  /** Removing a suppression resumes delivery - a deliberate operator action. */
  removeSuppression(input: { id: string; projectId: string }): Promise<void> {
    return this.#automation.removeSuppression(input);
  }

  /** One attempt at the unauthenticated pair, counted before anything is read. */
  async #countUnsubscribe(input: {
    action: "resolve" | "confirm" | "one-click";
    callerAddress: string | null;
    max: number;
  }): Promise<void> {
    const limit = await this.#limits.count({
      key: `unsubscribe:${input.action}:${input.callerAddress ?? "unknown"}`,
      windowSeconds: UNSUBSCRIBE_WINDOW_SECONDS,
      max: input.max,
    });

    if (!limit.allowed) throw new UnsubscribeRateLimitedError();
  }

  // ── the platform's own links ──────────────────────────────────────────────

  /**
   * The platform's own address for one automation resource. A deployment that
   * serves this family but named no public origin refuses by name.
   */
  countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<AutomationUsageCount> {
    return this.#automation.countUsage(input);
  }

  platformUrl(input: { projectSlug: string; path: string }): string {
    if (this.#publicBaseUrl === undefined) {
      throw new Error(
        "The triggers REST family was asked for a platform link, but this deployment named no public base URL",
      );
    }

    return automationPlatformUrl({ publicBaseUrl: this.#publicBaseUrl, ...input });
  }
}
