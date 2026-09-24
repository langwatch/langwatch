import { AnalyticsApi } from "@langwatch/analytics-contract";
import { AnnotationApi } from "@langwatch/annotation-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
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
  type AutomationAction,
  type AutomationAuthor,
  type AutomationEvaluationActivityContext,
  type AutomationEvaluationSubscriberContext,
  type AutomationEvaluationSubscriberEvent,
  type AutomationTraceSubscriberContext,
  type AutomationTestFireAuthor,
  type UnsubscribeChannel,
  type AutomationListRow,
  type AutomationPersistCapCount,
  type AutomationServerConfig,
  type CreateTriggerCommand,
  type CustomGraphNameRef,
  type EmailSuppression,
  type EmailSuppressionRow,
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
import type { EventingCommands } from "@langwatch/eventing";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { FeatureSetup, ResolvedTokens } from "@langwatch/kernel";
import {
  MonitorApi,
  type Monitor,
  type MonitorApi as MonitorApiContract,
} from "@langwatch/monitor-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { sessionSecret } from "@langwatch/secrets";
import type { Instant } from "@langwatch/time";
import { TraceApi } from "@langwatch/trace-contract";

import type { AutomationGraphNotifier } from "../channels/automation-graph-alert.channel.ts";
import type { AutomationRunawayNotice } from "../channels/automation-runaway-notice.channel.ts";
import type { SchedulerWake } from "../channels/automation-scheduler-wake.channel.ts";
import type { AutomationTestFire } from "../channels/automation-test-fire.channel.ts";
import {
  createAutomationsPipeline,
  type AutomationsPipeline,
} from "../eventing/automation.pipeline.ts";
import type { AutomationIntentRetention } from "../repositories/automation-intent-retention.repository.ts";
import type { AutomationPersistCapRepository } from "../repositories/automation-persist-cap.repository.ts";
import type { AutomationRunaway } from "../repositories/automation-runaway.repository.ts";
import type { AutomationScheduledJobRepository } from "../repositories/automation-scheduled-job.repository.ts";
import type { AutomationRepositories } from "../repositories/automation.repositories.ts";
import { automationPlatformUrl } from "../rules/automation-platform-url.rules.ts";
import { AutomationAuthoringService } from "../services/automation-authoring.service.ts";
import { AutomationEvaluationSubscriberService } from "../services/automation-evaluation-subscriber.service.ts";
import { AutomationEvaluationTriggerFilterService } from "../services/automation-evaluation-trigger-filter.service.ts";
import type {
  AutomationDispatchError,
  AutomationHeartbeat,
  AutomationLogger,
} from "../services/automation-graph-runtime.service.ts";
import { AutomationMatchRecordMetricsService } from "../services/automation-match-record-metrics.service.ts";
import {
  AutomationRulesService,
  type AutomationProjectIdentity,
} from "../services/automation-rules.service.ts";
import type { AutomationRunawaySignals } from "../services/automation-runaway-signals.service.ts";
import { OtelAutomationSettlementObservabilityAdapter } from "../services/automation-settlement-observability.service.ts";
import type { AutomationSlackBotTokenDecryptor } from "../services/automation-slack-secrets.service.ts";
import { AutomationTemplateService } from "../services/automation-template.service.ts";
import { AutomationTraceTriggerCatalogueService } from "../services/automation-trace-trigger-catalogue.service.ts";
import { AutomationTriggerMatchDispatcherService } from "../services/automation-trigger-match-dispatcher.service.ts";
import type { AutomationWebhookStoredParams } from "../services/automation-webhook-secrets.service.ts";
import { AutomationService } from "../services/automation.service.ts";
import { AutomationPersistCapService } from "../services/persist-cap.service.ts";
import { ReportScheduleService } from "../services/report-schedule.service.ts";
import { AutomationGraphService } from "../services/trigger-graph.service.ts";
import { HmacUnsubscribeTokenAdapter } from "../services/unsubscribe-token.service.ts";
import type { UnsubscribeTokenVerifier } from "../services/unsubscribe-token.service.ts";
import {
  buildAutomationInfrastructure,
  createAutomationSettlement,
  DatasetTraceMapper,
  LoggedSettlementBreach,
  PeerPersistActionWriter,
  type AutomationComposedInfrastructure,
  type AutomationProcessMembers,
  type AutomationSettlement,
} from "./automation-composition.build.ts";
import type { AutomationClock } from "./automation.members.ts";

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
  /** The stored Slack bot token in the clear, or nothing when none is stored. */
  findSlackBotToken(actionParams: unknown): string | null;
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
  jobs: AutomationScheduledJobRepository;
  clock: AutomationClock;
  wake: SchedulerWake;
  notifier: AutomationGraphNotifier;
  logger: AutomationLogger;
  slackTokens: AutomationSlackBotTokenDecryptor;
  dispatchErrors: AutomationDispatchError;
  heartbeat: AutomationHeartbeat;
  runaway: AutomationRunaway & AutomationRunawayNotice & AutomationRunawaySignals;
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

/** How often the unauthenticated unsubscribe pair may be asked, per caller. */
const UNSUBSCRIBE_WINDOW_SECONDS = 60;
const UNSUBSCRIBE_RESOLVE_MAX = 30;
const UNSUBSCRIBE_CONFIRM_MAX = 10;

type AutomationDependencies = Readonly<{
  analytics: typeof AnalyticsApi;
  monitors: typeof MonitorApi;
  featureFlags: typeof FeatureFlagApi;
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
}>;

/** Peers only settlement reads, which `create` composes and `fromInfrastructure` never sees. */
type AutomationSettlementPeer = "evaluations" | "datasets" | "annotations";

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
  audit: AutomationAuditSink;
  limits: AutomationCallCounter;
  publicBaseUrl: string | undefined;
  evaluations: AutomationEvaluationSubscriberService;
  triggerMatches: AutomationTriggerMatchDispatcherService;
  settlement: AutomationSettlement | undefined;
}

export class AutomationApp implements AutomationApi {
  static readonly contract = AutomationApiToken;
  static readonly dependencies = {
    analytics: AnalyticsApi,
    monitors: MonitorApi,
    featureFlags: FeatureFlagApi,
    entitlement: EntitlementApi,
    projects: ProjectApi,
    auditLog: AuditLogApi,
    traces: TraceApi,
    evaluations: EvaluationApi,
    datasets: DatasetApi,
    annotations: AnnotationApi,
  };
  static readonly config = automationServerConfig;
  /** Unsubscribe links are signed with auth's session key, as main signed them (§6). */
  static readonly secrets = { unsubscribe: sessionSecret } as const;
  static readonly reads = [
    "prisma",
    "redis",
    "logger",
    "encryption",
    "mail",
    "publicBaseUrl",
    "isSaas",
  ] as const;

  /**
   * Builds this process's own {@link AutomationInfrastructure} from the
   * members it reads and its own config, then composes exactly as
   * {@link AutomationApp.fromInfrastructure} does.
   */
  static create(setup: AutomationSetup): Promise<AutomationApp> {
    return setup.secrets.into(AutomationApp.secrets.unsubscribe, (unsubscribeSigningSecret) => {
      const infrastructure = buildAutomationInfrastructure({
        members: setup.members,
        auditLog: setup.dependencies.auditLog,
        verifier: HmacUnsubscribeTokenAdapter.create({ secret: unsubscribeSigningSecret }),
        unsubscribeSigningSecret,
        repositories: setup.repositories,
        caps: {
          emailHourlyCap: setup.config.emailHourlyCap,
          tenantDailyCap: setup.config.tenantDailyCap,
        },
      });
      const automation = AutomationApp.fromInfrastructure({
        infrastructure,
        dependencies: setup.dependencies,
        repositories: setup.repositories,
        config: setup.config,
      });
      automation.#settlement = AutomationApp.#composeSettlement(setup, infrastructure, automation);
      return automation;
    });
  }

  /** Main's worker-automation-settlement.composition.ts, over peers instead of foreign tables. */
  static #composeSettlement(
    setup: AutomationSetup,
    infrastructure: AutomationComposedInfrastructure,
    automation: AutomationApp,
  ): AutomationSettlement {
    const { members, dependencies, config } = setup;
    const logger = infrastructure.logger;
    return createAutomationSettlement({
      prisma: members.prisma,
      clock: infrastructure.clock,
      persistCapSlots: infrastructure.persistCaps,
      projects: dependencies.projects,
      traces: dependencies.traces,
      evaluations: dependencies.evaluations,
      traceFilters: dependencies.traces,
      evaluationFilters: dependencies.evaluations,
      mapper: new DatasetTraceMapper(),
      writer: new PeerPersistActionWriter({
        datasets: dependencies.datasets,
        annotations: dependencies.annotations,
      }),
      delivery: infrastructure.delivery,
      emailCaps: infrastructure.emailCaps,
      crypto: members.encryption,
      baseHost: members.publicBaseUrl ?? "",
      observability: OtelAutomationSettlementObservabilityAdapter.create({
        capture: (error, extra) =>
          logger.error({ ...extra, error: error.message }, "Automation settlement dispatch failed"),
      }),
      breach: new LoggedSettlementBreach(logger),
      analytics: dependencies.analytics,
      logger,
      graphActivity: automation.#automation,
      persistCeiling: {
        kind: "plan",
        projects: dependencies.projects,
        plans: dependencies.entitlement,
        free: config.persistDailyCapFree,
        paid: config.persistDailyCapPaid,
        enterprise: config.persistDailyCapEnterprise,
      },
      emailHourlyCap: config.emailHourlyCap,
      tenantDailyCap: config.tenantDailyCap,
    });
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
  }): AutomationApp {
    const { infrastructure: members, dependencies, repositories, config } = setup;

    const persistCaps = AutomationPersistCapService.create({
      projects: dependencies.projects,
      planProvider: dependencies.entitlement,
      config: {
        free: config.persistDailyCapFree,
        paid: config.persistDailyCapPaid,
        enterprise: config.persistDailyCapEnterprise,
      },
      slots: members.persistCaps,
    });
    const graph = AutomationGraphService.create({
      triggers: repositories.triggers,
      customGraphs: repositories.customGraphs,
      projects: dependencies.projects,
      analytics: dependencies.analytics,
      notifier: members.notifier,
      triggerSent: repositories.graphTriggerSent,
      logger: members.logger,
      slackTokens: members.slackTokens,
      dispatchErrors: members.dispatchErrors,
      runaway: members.runaway,
      clock: members.clock,
      baseHost: members.publicBaseUrl ?? "",
    });
    const automation = AutomationService.create({
      triggers: repositories.triggers,
      history: repositories.history,
      suppressions: repositories.suppressions,
      names: repositories.names,
      customGraphs: repositories.customGraphs,
      webhookDeliveries: repositories.webhookDeliveries,
      verifier: members.verifier,
      reportSchedules: ReportScheduleService.create({
        jobs: members.jobs,
        clock: members.clock,
        wake: members.wake,
        triggers: repositories.triggers,
      }),
      clock: members.clock,
      graph,
      templates: AutomationTemplateService.create({
        baseHost: members.publicBaseUrl ?? "",
        delivery: members.testFire,
      }),
      persistCaps,
    });
    const rules = AutomationRulesService.create({
      automation,
      projects: dependencies.projects,
      featureFlags: dependencies.featureFlags,
    });

    const triggerMatches = AutomationTriggerMatchDispatcherService.create();

    return new AutomationApp({
      automation,
      rules,
      authoring: AutomationAuthoringService.create({
        automation,
        rules,
        monitors: dependencies.monitors,
        providers: members.providers,
        slackChannels: members.slackChannels,
        traceFilters: members.traceFilters,
        limits: members.limits,
      }),
      monitors: dependencies.monitors,
      audit: members.audit,
      limits: members.limits,
      publicBaseUrl: members.publicBaseUrl,
      evaluations: AutomationEvaluationSubscriberService.create({
        triggers: AutomationTraceTriggerCatalogueService.create({
          triggers: repositories.triggers,
          clock: members.clock,
        }),
        graphActivity: automation,
        traces: dependencies.traces,
        evaluationFilters: AutomationEvaluationTriggerFilterService.create(dependencies.traces),
        triggerMatches,
        matchRecordMetrics: AutomationMatchRecordMetricsService.create(),
      }),
      triggerMatches,
      settlement: undefined,
    });
  }

  #automation: AutomationService;
  #rules: AutomationRulesService;
  #authoring: AutomationAuthoringService;
  #monitors: MonitorApiContract;
  #audit: AutomationAuditSink;
  #limits: AutomationCallCounter;
  readonly #publicBaseUrl: string | undefined;
  readonly #evaluations: AutomationEvaluationSubscriberService;
  readonly #triggerMatches: AutomationTriggerMatchDispatcherService;
  #settlement: AutomationSettlement | undefined;

  private constructor(collaborators: AutomationAppCollaborators) {
    this.#automation = collaborators.automation;
    this.#rules = collaborators.rules;
    this.#authoring = collaborators.authoring;
    this.#monitors = collaborators.monitors;
    this.#audit = collaborators.audit;
    this.#limits = collaborators.limits;
    this.#publicBaseUrl = collaborators.publicBaseUrl;
    this.#evaluations = collaborators.evaluations;
    this.#triggerMatches = collaborators.triggerMatches;
    this.#settlement = collaborators.settlement;
  }

  /** The `automations` pipeline, over the settlement {@link create} composed. */
  eventingPipeline({ retention }: { retention: AutomationIntentRetention }): AutomationsPipeline {
    if (!this.#settlement) {
      throw new Error("Automation was asked for its pipeline, but no settlement was composed");
    }
    return createAutomationsPipeline({ ...this.#settlement, retention });
  }

  /** Binds the registered `automations` pipeline's own senders. */
  connectCommands(commands: EventingCommands<AutomationsPipeline>): void {
    this.#triggerMatches.connect(commands);
  }

  // -- evaluation reactions ----------------------------------------------------

  /** Records a match for each trace trigger whose filter reads evaluations. */
  handleEvaluationTriggerMatch({
    event,
    context,
  }: {
    event: AutomationEvaluationSubscriberEvent;
    context: AutomationEvaluationSubscriberContext;
  }): Promise<void> {
    return this.#evaluations.handleEvaluationTriggerMatch(event, context);
  }

  handleTraceTriggerMatch({
    event,
    context,
  }: {
    event: AutomationEvaluationSubscriberEvent;
    context: AutomationTraceSubscriberContext;
  }): Promise<void> {
    return this.#evaluations.handleTraceTriggerMatch(event, context);
  }

  /** Re-evaluates the project's graph alerts after an evaluation finished. */
  handleEvaluationGraphTriggerActivity({
    event,
    context,
  }: {
    event: AutomationEvaluationSubscriberEvent;
    context: AutomationEvaluationActivityContext;
  }): Promise<void> {
    return this.#evaluations.handleEvaluationGraphTriggerActivity(event, context);
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

  /** Updates an automation. The service invalidates as part of the write. */
  update(command: UpdateTriggerCommand): Promise<Trigger> {
    return this.#automation.update(command);
  }

  /**
   * Removes an automation: the soft delete AND the retirement of any
   * scheduled-report entry, always both. A calendar entry left behind keeps
   * waking the scheduler forever. Idempotent for one that was never a report.
   */
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

  /** Refuses the webhook delivery channel unless the project has it (ADR-040 §7). */
  assertWebhookChannelEnabled(input: { projectId: string; userId: string }): Promise<void> {
    return this.#rules.assertWebhookChannelEnabled(input);
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
