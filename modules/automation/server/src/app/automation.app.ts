/**
 * The automation feature's application: the one typed thing all five of its
 * doors are given. Every rule two doors used to keep a copy of each lives here
 * or in the services below, and the caller arrives as an argument rather than
 * being read from a session, so one operation serves a browser, an API key and
 * a background job alike. @see adrs/001-automation-service-boundary.md
 */
import {
  automationServerConfigSchema,
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
  type AutomationTestFireAuthor,
  type UnsubscribeChannel,
  type AutomationListRow,
  type AutomationPersistCapCount,
  type AutomationServerConfig,
  type CreateTriggerCommand,
  type CustomGraphNameRef,
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
} from "@langwatch/automation-contract";
import { AnalyticsApi } from "@langwatch/analytics-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  MonitorApi,
  type Monitor,
  type MonitorApi as MonitorApiContract,
} from "@langwatch/monitor-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { Instant } from "@langwatch/time";

import {
  PostgresAutomationAdapter,
  type AutomationDatabase,
} from "../adapters/postgres.automation.adapter.ts";
import type { AutomationClockPort } from "../ports/automation-clock.port.ts";
import type {
  AutomationDispatchErrorPort,
  AutomationGraphNotifierPort,
  AutomationHeartbeatPort,
  AutomationLoggerPort,
  AutomationSlackBotTokenDecryptorPort,
} from "../ports/automation-graph.port.ts";
import type { AutomationWebhookStoredParams } from "../ports/automation-provider.port.ts";
import type { AutomationRunawayPort } from "../ports/automation-runaway.port.ts";
import type { AutomationTestFirePort } from "../ports/automation-test-fire.port.ts";
import type { ScheduledJobStorePort } from "../ports/scheduled-jobs.port.ts";
import type { SchedulerWakePort } from "../ports/scheduler-wake.port.ts";
import type { UnsubscribeTokenVerifierPort } from "../ports/unsubscribe-token.port.ts";
import { AutomationAuthoringService } from "../services/automation-authoring.service.ts";
import {
  AutomationRulesService,
  type AutomationProjectIdentity,
} from "../services/automation-rules.service.ts";
import { AutomationPersistCapService } from "../services/persist-cap.service.ts";
import type { AutomationPersistCapRedisPort } from "../services/persist-cap.service.ts";

export type { AutomationWebhookStoredParams };
export type { AutomationProjectIdentity };

// ---------------------------------------------------------------------------
// The technical infrastructure the process supplies. None of it is automation's
// own: a cipher, an HTTP client, a query compiler, a counter and an audit
// ledger all belong to the deployment, and every one of them was a transport
// port before - reachable from one door and invisible to the next.
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
  database: AutomationDatabase;
  verifier: UnsubscribeTokenVerifierPort;
  jobs: ScheduledJobStorePort;
  clock: AutomationClockPort;
  wake: SchedulerWakePort;
  notifier: AutomationGraphNotifierPort;
  logger: AutomationLoggerPort;
  slackTokens: AutomationSlackBotTokenDecryptorPort;
  dispatchErrors: AutomationDispatchErrorPort;
  heartbeat: AutomationHeartbeatPort;
  runaway: AutomationRunawayPort;
  testFire: AutomationTestFirePort;
  redis: AutomationPersistCapRedisPort | null;
  providers: AutomationProviderSecrets;
  slackChannels: AutomationSlackDirectory;
  traceFilters: AutomationTraceFilterCompiler;
  limits: AutomationCallCounter;
  audit: AutomationAuditSink;
  // Peer APIs are resolved from setup.dependencies; infrastructure contains technical ports only.
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
}>;

type AutomationSetup = FeatureSetup<
  AutomationDependencies,
  AutomationInfrastructure,
  AutomationServerConfig
>;

/** What the application is composed from, once the process has supplied it. */
interface AutomationAppCollaborators {
  automation: AutomationApi;
  monitors: MonitorApiContract;
  rules: AutomationRulesService;
  authoring: AutomationAuthoringService;
  audit: AutomationAuditSink;
  limits: AutomationCallCounter;
}

export class AutomationApp implements AutomationApi {
  static readonly contract = AutomationApiToken;
  static readonly dependencies = {
    analytics: AnalyticsApi,
    monitors: MonitorApi,
    featureFlags: FeatureFlagApi,
    entitlement: EntitlementApi,
    projects: ProjectApi,
  };
  static readonly configSchema: { parse(value: unknown): AutomationServerConfig } =
    automationServerConfigSchema;

  static create(setup: AutomationSetup): AutomationApp {
    const persistCaps = AutomationPersistCapService.create({
      projects: setup.dependencies.projects,
      planProvider: setup.dependencies.entitlement,
      config: {
        free: setup.config.persistDailyCapFree,
        paid: setup.config.persistDailyCapPaid,
        enterprise: setup.config.persistDailyCapEnterprise,
      },
      redis: setup.infrastructure.redis,
    });
    const automation = PostgresAutomationAdapter.create({
      database: setup.infrastructure.database,
      verifier: setup.infrastructure.verifier,
      jobs: setup.infrastructure.jobs,
      clock: setup.infrastructure.clock,
      wake: setup.infrastructure.wake,
      projects: setup.dependencies.projects,
      analytics: setup.dependencies.analytics,
      notifier: setup.infrastructure.notifier,
      baseHost: setup.config.baseHost,
      logger: setup.infrastructure.logger,
      slackTokens: setup.infrastructure.slackTokens,
      dispatchErrors: setup.infrastructure.dispatchErrors,
      heartbeat: setup.infrastructure.heartbeat,
      runaway: setup.infrastructure.runaway,
      testFire: setup.infrastructure.testFire,
      persistCaps,
    }).build();
    const rules = AutomationRulesService.create({
      automation,
      projects: setup.dependencies.projects,
      featureFlags: setup.dependencies.featureFlags,
    });

    return new AutomationApp({
      automation,
      rules,
      authoring: AutomationAuthoringService.create({
        automation,
        rules,
        monitors: setup.dependencies.monitors,
        providers: setup.infrastructure.providers,
        slackChannels: setup.infrastructure.slackChannels,
        traceFilters: setup.infrastructure.traceFilters,
        limits: setup.infrastructure.limits,
      }),
      monitors: setup.dependencies.monitors,
      audit: setup.infrastructure.audit,
      limits: setup.infrastructure.limits,
    });
  }

  #automation: AutomationApi;
  #rules: AutomationRulesService;
  #authoring: AutomationAuthoringService;
  #monitors: MonitorApiContract;
  #audit: AutomationAuditSink;
  #limits: AutomationCallCounter;

  private constructor(collaborators: AutomationAppCollaborators) {
    this.#automation = collaborators.automation;
    this.#rules = collaborators.rules;
    this.#authoring = collaborators.authoring;
    this.#monitors = collaborators.monitors;
    this.#audit = collaborators.audit;
    this.#limits = collaborators.limits;
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
  tryGetById(input: { triggerId: string; projectId: string }): Promise<Trigger | null> {
    return this.#automation.tryGetById(input);
  }

  /** One automation with every secret stripped, for a browser to read. */
  findRedactedById(input: { triggerId: string; projectId: string }): Promise<Trigger | null> {
    return this.#authoring.findRedactedById(input);
  }

  /** One LIVE automation, or null when the project does not have one. */
  tryGetLiveById(input: { triggerId: string; projectId: string }): Promise<Trigger | null> {
    return this.#rules.findLiveById(input);
  }

  /** One live automation, refusing when the project does not have it. */
  requireById(input: { triggerId: string; projectId: string }): Promise<Trigger> {
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
  requireCustomGraphInProject(input: {
    customGraphId: string;
    projectId: string;
  }): Promise<void> {
    return this.#rules.assertCustomGraphInProject(input);
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
   * Stores a new TRACE automation, which must say which traces it is about: one
   * with no condition matches every trace forever. Graph alerts and reports are
   * exempt - a threshold and a schedule are their conditions - and use
   * {@link create}.
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
  tryResolveUnsubscribeView(input: { token: string }): Promise<{
    projectName: string;
    triggerName: string | null;
    email: string;
  } | null> {
    return this.#automation.tryResolveUnsubscribeView(input);
  }

  /**
   * The unsubscribe page's own read, throttled per caller.
   *
   * Public, so it is a surface an attacker can hammer to brute-force tokens;
   * an unknown caller falls back to a shared bucket, because a missing address
   * must still throttle rather than bypass.
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

    const view = await this.#automation.tryResolveUnsubscribeView({ token: input.token });

    if (!view) {
      throw new UnsubscribeLinkInvalidError("This unsubscribe link is invalid or has expired.", 404);
    }

    return view;
  }

  /** Records the unsubscribe. Idempotent - the upsert collapses duplicates. */
  confirmUnsubscribe(input: { token: string; scope: "trigger" | "project" }): Promise<void> {
    return this.#automation.confirmUnsubscribe(input);
  }

  /**
   * The same confirmation from either affordance, throttled per caller.
   *
   * A bad or tampered token is the recipient's problem and they can act on it:
   * ask for the link again. A downstream persistence failure is ours, has no
   * action for them, and is re-raised exactly as it arrived so it degrades to
   * "unknown" plus a trace id rather than masquerading as an invalid link.
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

  /**
   * The operator-facing suppression list, each row with its automation's name.
   *
   * Audited explicitly rather than by the mutation trail: this is a query, and
   * reading a suppression list means reading customer email addresses.
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
}
