/**
 * The automation feature's application: what all three of its doors call.
 *
 * It holds every service the feature reaches, and it is the one typed thing a
 * transport is given. Before it, each door declared its own private bag —
 * `Readonly<{ automation; monitors; projects; featureFlags }>` in the
 * authoring surface, `Readonly<{ automation }>` in the email-suppression one,
 * and a bare `() => AutomationService` in the REST family — three descriptions
 * of the same composition, agreeing by attention rather than by construction,
 * and none of them reachable from the others.
 *
 * Most operations are the services' own, reached through the delegating
 * methods below. What lives here as a rule is what a door would otherwise have
 * to know, and did, twice or three times over:
 *
 *   - a trace automation needs a condition, on create and on edit. Both doors
 *     enforced it, in two copies of the same four-clause rule, and the REST
 *     family's copy would have been the one to silently rot;
 *   - "this automation is not in this project" is one refusal. The REST family
 *     treated a soft-deleted row as absent and the tRPC surface did not, so
 *     the same id answered "gone" at one door and "here it is" at the other;
 *   - the webhook delivery channel's flag gate, which the save path and the
 *     test-fire path each read for themselves.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
 */
import {
  hasActionableTriggerFilters,
  ProjectNotFoundError,
  type AutomationService,
  type CreateTriggerCommand,
  type CustomGraphNameRef,
  type EmailSuppression,
  type ReportSchedule,
  type TestFireInput,
  type TestFireResult,
  type TestFireTemplateDraft,
  type Trigger,
  type TriggerFire,
  type TriggerFireStats,
  type UpdateTriggerCommand,
  type WebhookDeliveryRow,
  type AutomationPersistCapCount,
  TriggerFiltersRequiredError,
} from "@langwatch/automation-contract";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { HandledError, NotFoundError } from "@langwatch/handled-error";
import type { Monitor, MonitorService } from "@langwatch/monitor-contract";
import type { ProjectService } from "@langwatch/project-contract";

// ---------------------------------------------------------------------------
// The refusals this feature names.
//
// Each one has a cause we can name and an action the caller can take, which is
// what makes it a `HandledError` rather than a transport error a door builds
// for itself. Every status below is the status that door already answered
// with: this move renames the channel, never the outcome.
// ---------------------------------------------------------------------------

/** One automation, looked up in a project that does not have it. */
export class AutomationNotInProjectError extends NotFoundError {
  declare readonly code: "automation_not_found";

  constructor(triggerId: string, projectId: string) {
    super("automation_not_found", "Automation", triggerId, { meta: { projectId } });
    this.name = "AutomationNotInProjectError";
  }
}

/** The custom graph a graph alert names does not belong to the project. */
export class GraphNotInProjectError extends NotFoundError {
  declare readonly code: "graph_not_found";

  constructor(customGraphId: string, projectId: string) {
    super("graph_not_found", "Graph", customGraphId, { meta: { projectId } });
    this.name = "GraphNotInProjectError";
  }
}

/**
 * The legacy create mutation cannot carry the validated, encrypted webhook
 * destination shape, so a webhook automation has to be written by the
 * provider-aware upsert.
 */
export class AutomationWebhookUpsertRequiredError extends HandledError {
  declare readonly code: "automation_webhook_upsert_required";

  constructor() {
    super(
      "automation_webhook_upsert_required",
      "Webhook automations must be created through the provider-aware upsert API.",
      { httpStatus: 400 },
    );
    this.name = "AutomationWebhookUpsertRequiredError";
  }
}

/** The webhook delivery channel is not switched on for this project (ADR-040 §7). */
export class AutomationWebhookNotEnabledError extends HandledError {
  declare readonly code: "automation_webhook_not_enabled";

  constructor(projectId: string) {
    super(
      "automation_webhook_not_enabled",
      "Webhook automations are not enabled for this project.",
      { httpStatus: 403, meta: { projectId } },
    );
    this.name = "AutomationWebhookNotEnabledError";
  }
}

/**
 * Every condition on the saved automation names a field this platform no
 * longer supports, so saving it would leave the automation matching nothing an
 * author could still see.
 */
export class AutomationFiltersUnsupportedError extends HandledError {
  declare readonly code: "automation_filters_unsupported";

  constructor(unknownFields: readonly string[]) {
    super(
      "automation_filters_unsupported",
      "This automation only contains unsupported legacy filters. Add at least one supported filter before saving.",
      { httpStatus: 400, meta: { fields: [...unknownFields] } },
    );
    this.name = "AutomationFiltersUnsupportedError";
  }
}

/** The author's trace-filter query does not compile. */
export class AutomationTraceFilterInvalidError extends HandledError {
  declare readonly code: "automation_trace_filter_invalid";

  constructor(reason: string) {
    super("automation_trace_filter_invalid", `Invalid trace filter: ${reason}`, {
      httpStatus: 400,
      meta: { reason },
    });
    this.name = "AutomationTraceFilterInvalidError";
  }
}

/** Resuming a report whose stored schedule can no longer be read. */
export class ReportScheduleMissingError extends HandledError {
  declare readonly code: "report_schedule_missing";

  constructor() {
    super(
      "report_schedule_missing",
      "This report has no valid schedule. Edit it and pick a schedule before resuming it.",
      { httpStatus: 400 },
    );
    this.name = "ReportScheduleMissingError";
  }
}

/** A report renders a notification, so it can only use a notification channel. */
export class ReportChannelUnsupportedError extends HandledError {
  declare readonly code: "report_channel_unsupported";

  constructor() {
    super(
      "report_channel_unsupported",
      "Reports can only send Email or Slack notifications.",
      { httpStatus: 400 },
    );
    this.name = "ReportChannelUnsupportedError";
  }
}

/** A graph alert fires a notification; there is no "add to dataset on a breach". */
export class GraphAlertChannelUnsupportedError extends HandledError {
  declare readonly code: "graph_alert_channel_unsupported";

  constructor() {
    super(
      "graph_alert_channel_unsupported",
      "Graph alerts only support notify channels (Email, Slack, or a webhook).",
      { httpStatus: 400 },
    );
    this.name = "GraphAlertChannelUnsupportedError";
  }
}

/** A graph alert without a threshold rule has no condition to fire on. */
export class GraphAlertThresholdRequiredError extends HandledError {
  declare readonly code: "graph_alert_threshold_required";

  constructor() {
    super(
      "graph_alert_threshold_required",
      "Graph alerts require a threshold rule (operator, threshold, time period, series).",
      { httpStatus: 400 },
    );
    this.name = "GraphAlertThresholdRequiredError";
  }
}

/** A graph alert says how loud it is; without a severity it cannot be routed. */
export class GraphAlertSeverityRequiredError extends HandledError {
  declare readonly code: "graph_alert_severity_required";

  constructor() {
    super("graph_alert_severity_required", "Graph alerts require an alert severity.", {
      httpStatus: 400,
    });
    this.name = "GraphAlertSeverityRequiredError";
  }
}

/**
 * Hygiene on the test-fire button, not anti-abuse: the recipient is always the
 * requester, so this exists to stop a stuck client looping on the mail
 * provider or on a customer's own webhook receiver (ADR-040 §4).
 */
export class TestFireRateLimitedError extends HandledError {
  declare readonly code: "test_fire_rate_limited";

  constructor(message: string, resetAt: number) {
    super("test_fire_rate_limited", message, {
      httpStatus: 429,
      retryable: true,
      meta: { resetAt },
    });
    this.name = "TestFireRateLimitedError";
  }
}

/**
 * The unauthenticated unsubscribe pair, throttled per client IP (ADR-031).
 * Public, so it is a surface an attacker can hammer to brute-force tokens.
 */
export class UnsubscribeRateLimitedError extends HandledError {
  declare readonly code: "unsubscribe_rate_limited";

  constructor() {
    super("unsubscribe_rate_limited", "Too many requests. Please try again shortly.", {
      httpStatus: 429,
      retryable: true,
    });
    this.name = "UnsubscribeRateLimitedError";
  }
}

/**
 * The token in an unsubscribe link is invalid, tampered with, or names a
 * project that no longer exists.
 *
 * The status is the caller's, not the cause's: resolving a link that resolves
 * to nothing has always been a 404, and confirming with a token that does not
 * verify has always been a 400. One code, because it is one cause and one
 * remedy — ask for the link again.
 */
export class UnsubscribeLinkInvalidError extends HandledError {
  declare readonly code: "unsubscribe_link_invalid";

  constructor(message: string, httpStatus: 400 | 404) {
    super("unsubscribe_link_invalid", message, { httpStatus });
    this.name = "UnsubscribeLinkInvalidError";
  }
}

// ---------------------------------------------------------------------------
// The application
// ---------------------------------------------------------------------------

/** What the process composes this feature's application from. */
export interface AutomationAppDependencies {
  automation: AutomationService;
  monitors: MonitorService;
  projects: ProjectService;
  featureFlags: FeatureFlagService;
}

/** The project an automation names, as a test fire renders it. */
export interface AutomationProjectIdentity {
  readonly name: string;
  readonly slug: string;
}

export class AutomationApp {
  static create(dependencies: AutomationAppDependencies): AutomationApp {
    return new AutomationApp(dependencies);
  }

  private constructor(private readonly dependencies: AutomationAppDependencies) {}

  // -- reads -----------------------------------------------------------------

  /** Every automation in the project, deleted rows excluded by the service. */
  getAllForProject(input: { projectId: string }): Promise<Trigger[]> {
    return this.dependencies.automation.getAllForProject(input);
  }

  /** One automation, or null when the project does not have it. */
  tryGetById(input: { triggerId: string; projectId: string }): Promise<Trigger | null> {
    return this.dependencies.automation.tryGetById(input);
  }

  /**
   * One LIVE automation, or null when the project does not have one.
   *
   * "Live" is the decision this method exists for. `tryGetById` answers with
   * soft-deleted rows too, so every caller had to remember to test `deleted` —
   * and the two doors did not agree: the REST family tested for it and the tRPC
   * surface did not, so the same id answered "gone" at one door and "here it
   * is" at the other. A door still chooses how to refuse; what "there" means is
   * decided here.
   */
  async tryGetLiveById(input: {
    triggerId: string;
    projectId: string;
  }): Promise<Trigger | null> {
    const trigger = await this.dependencies.automation.tryGetById(input);
    return !trigger || trigger.deleted ? null : trigger;
  }

  /** One live automation, refusing when the project does not have it. */
  async requireById(input: { triggerId: string; projectId: string }): Promise<Trigger> {
    const trigger = await this.tryGetLiveById(input);
    if (!trigger) throw new AutomationNotInProjectError(input.triggerId, input.projectId);
    return trigger;
  }

  /** One automation by the custom graph it watches, or null. */
  tryGetByCustomGraphId(input: {
    projectId: string;
    customGraphId: string;
  }): Promise<Trigger | null> {
    return this.dependencies.automation.tryGetByCustomGraphId(input);
  }

  /**
   * Refuses a graph alert whose graph is not this project's.
   *
   * Without it a hostile client could attach an alert to another tenant's
   * graph, so the check belongs where both doors reach it rather than in the
   * one handler that happens to have it today.
   */
  async requireCustomGraphInProject(input: {
    customGraphId: string;
    projectId: string;
  }): Promise<void> {
    const exists = await this.dependencies.automation.customGraphExistsInProject(input);
    if (!exists) throw new GraphNotInProjectError(input.customGraphId, input.projectId);
  }

  /** The names of the custom graphs a list of automations points at. */
  getCustomGraphNamesByIds(input: {
    customGraphIds: string[];
    projectId: string;
  }): Promise<CustomGraphNameRef[]> {
    return this.dependencies.automation.getCustomGraphNamesByIds(input);
  }

  /** The monitors an automation's conditions name. */
  getMonitorsByIds(input: { monitorIds: string[]; projectId: string }): Promise<Monitor[]> {
    return this.dependencies.monitors.getAllByIds(input);
  }

  /** The plan's daily ceiling on persist actions. */
  resolvePersistDailyCap(projectId: string): Promise<number> {
    return this.dependencies.automation.resolvePersistDailyCap(projectId);
  }

  /** Today's confirmed-match and skipped counts, per automation. */
  readPersistCapCounts(input: {
    projectId: string;
    triggerIds: readonly string[];
    now: Date;
    cap: number;
  }): Promise<Record<string, AutomationPersistCapCount>> {
    return this.dependencies.automation.readPersistCapCounts(input);
  }

  /** How often each automation has fired. */
  getFireStats(input: { projectId: string }): Promise<TriggerFireStats[]> {
    return this.dependencies.automation.getFireStats(input);
  }

  /** The activity feed, for one automation or for the whole project. */
  getRecentFires(input: {
    projectId: string;
    triggerId?: string;
    limit: number;
  }): Promise<TriggerFire[]> {
    return this.dependencies.automation.getRecentFires(input);
  }

  /** The per-attempt webhook delivery log for one automation (ADR-040 §6). */
  getRecentWebhookDeliveries(input: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<WebhookDeliveryRow[]> {
    return this.dependencies.automation.getRecentWebhookDeliveries(input);
  }

  /** When each report next runs and last ran, as the scheduler knows it. */
  getReportSchedules(input: { projectId: string }): Promise<ReportSchedule[]> {
    return this.dependencies.automation.getReportSchedules(input);
  }

  // -- writes ----------------------------------------------------------------

  /**
   * Stores a new automation. The service invalidates the project's dispatch
   * cache as part of the write, so nothing here has to remember to.
   */
  create(command: CreateTriggerCommand): Promise<Trigger> {
    return this.dependencies.automation.create(command);
  }

  /**
   * Stores a new TRACE automation, which must say which traces it is about.
   *
   * Both doors enforced this for themselves, and both were right to: an
   * automation with no condition matches every trace forever, so the easiest
   * possible create call produced the most expensive possible automation.
   * Graph alerts and reports are exempt — an alert's condition is its
   * threshold and a report's is its schedule — so they use {@link create}.
   */
  async createTraceAutomation(command: CreateTriggerCommand): Promise<Trigger> {
    this.assertTraceConditionPresent(command.filters);
    return this.create(command);
  }

  /** Updates an automation. The service invalidates as part of the write. */
  update(command: UpdateTriggerCommand): Promise<Trigger> {
    return this.dependencies.automation.update(command);
  }

  /**
   * Removes an automation: the soft delete, and the retirement of any
   * scheduled-report entry.
   *
   * Both, always. A report whose calendar entry was left behind keeps waking
   * the scheduler forever, and the handler then reloads a row it can no longer
   * parse and skips every cadence. Idempotent for an automation that was never
   * a report, which costs one no-op deactivate.
   */
  async delete(input: { triggerId: string; projectId: string }): Promise<void> {
    await this.dependencies.automation.softDeleteById(input);
    await this.dependencies.automation.removeReportSchedule({
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
    return this.dependencies.automation.syncReportSchedule(input);
  }

  /** Retires one report's calendar entry. Idempotent. */
  removeReportSchedule(input: { projectId: string; triggerId: string }): Promise<void> {
    return this.dependencies.automation.removeReportSchedule(input);
  }

  /** Flushes the project's dispatch cache. */
  invalidate(projectId: string): Promise<void> {
    return this.dependencies.automation.invalidate(projectId);
  }

  // -- rules -----------------------------------------------------------------

  /**
   * Refuses a trace automation with no condition.
   *
   * Named rather than inlined because three call sites need it and one of them
   * — the edit path — reaches it through {@link assertConditionSurvivesEdit}.
   */
  assertTraceConditionPresent(filters: Record<string, unknown> | undefined): void {
    if (!hasActionableTriggerFilters(filters ?? {})) {
      throw new TriggerFiltersRequiredError();
    }
  }

  /**
   * Refuses an edit that would leave a trace automation matching everything.
   *
   * Editing is the other route to a match-everything automation: create it
   * with a real condition, then clear the condition. The existing row decides
   * whether that is allowed — an automation whose condition lives in its query
   * keeps a legitimately empty structured set, and alerts and reports have no
   * trace condition to require in the first place.
   */
  assertConditionSurvivesEdit(input: {
    existing: Trigger;
    filters: Record<string, unknown> | undefined;
  }): void {
    if (input.filters === undefined) return;
    if (hasActionableTriggerFilters(input.filters)) return;
    if (input.existing.triggerKind !== "AUTOMATION") return;
    if ((input.existing.filterQuery ?? "").trim() !== "") return;
    throw new TriggerFiltersRequiredError();
  }

  /** The template draft an author is about to save. Throws on a bad template. */
  validateTemplateDraft(draft: TestFireTemplateDraft): void {
    this.dependencies.automation.validateTemplateDraft(draft);
  }

  /**
   * Refuses the webhook delivery channel unless it is switched on for the
   * project (ADR-040 §7).
   *
   * The picker is flag-gated client-side and both writing doors gate it too,
   * so the flag cannot be bypassed by calling the API directly.
   */
  async assertWebhookChannelEnabled(input: {
    projectId: string;
    userId: string;
  }): Promise<void> {
    const allowed = await this.dependencies.featureFlags.isEnabled(
      "release_webhook_automations",
      { kind: "project", userId: input.userId, projectId: input.projectId },
    );
    if (!allowed) throw new AutomationWebhookNotEnabledError(input.projectId);
  }

  // -- the project an automation belongs to ----------------------------------

  /** The project's name and slug, as a rendered notification quotes them. */
  async getProjectIdentity(projectId: string): Promise<AutomationProjectIdentity> {
    const project = await this.dependencies.projects.tryGetSummaryById(projectId);
    if (!project) throw new ProjectNotFoundError(projectId);
    return { name: project.name, slug: project.slug };
  }

  // -- the test fire ---------------------------------------------------------

  /** Renders and delivers one test notification (ADR-031). */
  testFire(input: TestFireInput): Promise<TestFireResult> {
    return this.dependencies.automation.testFire(input);
  }

  // -- email suppression (ADR-031) -------------------------------------------

  /** The masked recipient and names behind an unsubscribe token, or null. */
  tryResolveUnsubscribeView(input: { token: string }): Promise<{
    projectName: string;
    triggerName: string | null;
    email: string;
  } | null> {
    return this.dependencies.automation.tryResolveUnsubscribeView(input);
  }

  /** Records the unsubscribe. Idempotent — the upsert collapses duplicates. */
  confirmUnsubscribe(input: { token: string; scope: "trigger" | "project" }): Promise<void> {
    return this.dependencies.automation.confirmUnsubscribe(input);
  }

  /** The operator-facing suppression list, each row with its automation's name. */
  getSuppressionsEnriched(input: {
    projectId: string;
  }): Promise<Array<EmailSuppression & { triggerName: string | null }>> {
    return this.dependencies.automation.getAllEnriched(input);
  }

  /** Removing a suppression resumes delivery — a deliberate operator action. */
  removeSuppression(input: { id: string; projectId: string }): Promise<void> {
    return this.dependencies.automation.removeSuppression(input);
  }
}
