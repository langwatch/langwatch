/**
 * The operator back office's application: what its door calls.
 *
 * It holds every capability the feature's api file reaches - the operations
 * service and the three explorers the process composes alongside it, the
 * feature-flag registry and the project search - and it is the one typed thing
 * a transport is given. Before it, the api file declared that composition
 * inline as a private `OpsApplication` bag, so nothing outside that one file
 * could reach it and a second door would have had to describe it again.
 *
 * Most operations are the composed capabilities' own, reached through
 * {@link operations}, {@link events}, {@link processes} and {@link replay}.
 * What lives here as a rule of its own is what the transport was deciding for
 * itself:
 *
 *   - the extra gate on a destructive operator write, which eight procedures
 *     called and any new one could forget;
 *   - what a deployment with no snapshot collector answers, which three read
 *     procedures each decided separately;
 *   - that only a registered flag key may be written, which the two
 *     feature-flag writes checked with two copies of the same line;
 *   - that a missing queue group or projection is a not-found rather than a
 *     null the caller has to interpret.
 *
 * The operator arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve the back office, a script and a future
 * REST door without knowing which it is serving.
 */
import {
  AuditLogApi,
  type AuditLogApi as AuditLogApiContract,
  type RecordAuditLogCommand,
} from "@langwatch/audit-log-contract";
import type {
  FeatureFlagRules,
  FeatureFlagApi,
  OperatorFeatureFlagCatalogue,
} from "@langwatch/feature-flag-contract";
import { listFeatureFlags } from "@langwatch/feature-flag-contract";
import { HandledError, NotFoundError } from "@langwatch/handled-error";
import type { OpsService } from "../services/ops.service.ts";
import type { AdminIdentity, AggregateDiscovery, AggregateEventView, AggregateProcessManager, AggregateSearchResult, Anomaly, AnomalyKind, DashboardData, DeadLetterCount, DeadOutboxMessageView, GroupInfo, OpsSnapshotService, OutboxAttemptView, ProcessAuditEntryView, ProcessFleetSummary, ProcessInstanceDetail, ProcessInstanceRow, ProcessOutboxMessageView, ProcessWakeRow, ProjectionStateAtEvent, ReplayHistoryEntry, ReplayStatus } from "@langwatch/ops-contract";
import type {
  BugReport,
  BugReportListing,
  ListBugReportsInput,
  OpsApiGetBadgeCountsOutput,
  OpsEventLogSearchWindow,
  OpsGrafanaLinkConfig,
  OpsMigrationCohortResult,
  OpsMigrationEnrollmentListing,
  OpsMigrationOrganizationMatch,
  OpsMigrationOverview,
  OpsMigrationTargetedRunResult,
  OpsOperator,
  OpsOperatorPermission,
  OpsPipelineRegistrations,
  OpsExplainAnswer,
  OpsExplainRequest,
  OpsScope,
  SubmitBugReport,
} from "@langwatch/ops-contract";
import { AdminSurfaceHiddenError, OpsApi } from "@langwatch/ops-contract";
import { AuthApi, type AuthApi as AuthApiContract } from "@langwatch/auth-contract";
import {
  ProjectApi,
  type ProjectApi as ProjectApiContract,
  type SearchProjectsResult,
} from "@langwatch/project-contract";
import { UserApi, type UserApi as UserApiContract } from "@langwatch/user-contract";
import { ApiKeyApi, type ApiKeyApi as ApiKeyApiContract } from "@langwatch/api-key-contract";
import type { OpsRepositories } from "#repositories/ops.repositories";
import { BugReportInboxService } from "#services/bug-report-inbox.service";
import { BugReportIntakeService } from "#services/bug-report-intake.service";
import { OpsExplainService } from "#services/ops-clickhouse-explain.service";
import { OpsExplainClickHouseRepository } from "#repositories/clickhouse/clickhouse.ops-explain.repository";
import type { OpsExplainClients } from "#repositories/observe/ops-explain.repository";
import type { OpsEventingIntrospection } from "./ops.app.ts";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { timingSafeEqual } from "node:crypto";
import { Instant, nowInstant } from "@langwatch/time";
import {
  buildExplainQuery,
  redactQueryForAudit,
} from "../rules/ops-clickhouse-explain.rules.ts";
import { withKillSwitchDescriptors } from "../rules/ops-kill-switch-catalogue.rules.ts";

import type { RegisteredFoldProjection, RegisteredMapProjection, RegisteredStateProjection, ReplayService as EventingReplayService } from "@langwatch/eventing";
/**
 * Who an operator request is attributed to: the impersonator where there is
 * one, so a back-office read is recorded against the human who made it rather
 * than against the account they were borrowing.
 */
function actingIdentityOf(operator: OpsOperator): OpsOperator;
function actingIdentityOf(operator: OpsOperator | null): OpsOperator;
function actingIdentityOf(operator: OpsOperator | null): OpsOperator {
  if (!operator) return { id: "" };

  const { impersonator } = operator;

  if (!impersonator) return operator;

  return {
    ...operator,
    ...(impersonator.id === undefined ? {} : { id: impersonator.id }),
    ...(impersonator.email === undefined ? {} : { email: impersonator.email }),
  };
}

/** How far back an event-log search reaches when the caller names no bound. */
const EVENT_LOG_SEARCH_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;

/** What every audited row on the support inbox points at. */
const BUG_REPORT_TARGET_KIND = "bugReport";

/** One process ref, the triple every process-manager read is keyed by. */
export type OpsProcessRef = {
  processName: string;
  projectId: string;
  processKey: string;
};

/**
 * The event-sourcing explorers and the replay runner, each narrowed to what
 * this feature calls.
 *
 * Structural rather than imported, because they are the process's own
 * composition over its event store - but typed with the contract's
 * vocabulary, not `unknown`. They were `Promise<unknown>` under a comment
 * claiming the concrete types reached the client "through the context type
 * rather than through these shapes", and nothing did: a tRPC procedure
 * publishes what its handler returns, so `unknown` here is `{}` in the
 * browser, and every field the operator pages read was unchecked.
 */
export type OpsEventExplorer = {
  discoverAggregates(input: {
    projectionNames: string[];
    since: string;
    tenantIds: string[];
  }): Promise<AggregateDiscovery>;
  searchAggregates(input: {
    query: string;
    tenantIds: string[];
    sinceMs: number;
  }): Promise<AggregateSearchResult[]>;
  getAggregateEvents(input: {
    aggregateId: string;
    tenantId: string;
    limit: number;
  }): Promise<AggregateEventView[]>;
  computeProjectionState(input: {
    aggregateId: string;
    tenantId: string;
    projectionName: string;
    eventIndex: number;
  }): Promise<ProjectionStateAtEvent>;
};

export type OpsProcessExplorer = {
  getForAggregate(input: {
    aggregateType: string;
    projectId: string;
    aggregateId: string;
  }): Promise<AggregateProcessManager[]>;
  requeueDeadMessages(input: {
    processName: string;
    projectId: string;
    processKey: string;
    messageKeyPrefix?: string;
    requestedBy: string;
  }): Promise<{ requeued: number }>;
  getFleetSummary(): Promise<ProcessFleetSummary[]>;
  getDeadLetters(input: { processName?: string; page: number; pageSize: number }): Promise<{
    messages: DeadOutboxMessageView[];
    total: number;
    byProcess: DeadLetterCount[];
  }>;
  getDeadLetterCounts(): Promise<DeadLetterCount[]>;
  getInstances(input: {
    processName?: string;
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ instances: ProcessInstanceRow[]; total: number }>;
  getUpcomingWakes(input: { limit: number }): Promise<ProcessWakeRow[]>;
  findInstanceDetail(input: { ref: OpsProcessRef }): Promise<ProcessInstanceDetail | null>;
  getOutbox(input: {
    ref: OpsProcessRef;
    page: number;
    pageSize: number;
  }): Promise<{ messages: ProcessOutboxMessageView[]; total: number }>;
  listRecentActions(input: { limit: number }): Promise<ProcessAuditEntryView[]>;
  wakeNow(input: { ref: OpsProcessRef; actorUserId: string }): Promise<{ woke: boolean }>;
  redriveDeadInstance(input: {
    ref: OpsProcessRef;
    actorUserId: string;
  }): Promise<{ requeued: number }>;
  redriveDeadMessage(input: {
    ref: OpsProcessRef;
    messageId: string;
    actorUserId: string;
  }): Promise<{ redriven: boolean }>;
  discardDeadMessage(input: {
    ref: OpsProcessRef;
    messageId: string;
    actorUserId: string;
  }): Promise<{ discarded: boolean }>;
  redriveDeadLetters(input: {
    processName?: string;
    actorUserId: string;
  }): Promise<{ redriven: number }>;
  discardDeadLetters(input: {
    processName?: string;
    actorUserId: string;
  }): Promise<{ discarded: number }>;
  getOutboxAttempts(input: { outboxId: string; projectId: string }): Promise<OutboxAttemptView[]>;
  releaseLapsedLease(input: {
    ref: OpsProcessRef;
    messageId: string;
    actorUserId: string;
  }): Promise<{ released: boolean }>;
};

/**
 * The projection replay runner, as the operator surface calls it.
 *
 * Typed with the contract's own vocabulary rather than `unknown`. It was the
 * latter, and `unknown` is what the browser receives as `{}` - every field the
 * replay drawer, the history table and the status banner read came back
 * unchecked.
 */
export type OpsReplayRunner = {
  getHistory(): Promise<ReplayHistoryEntry[]>;
  findHistoryEntry(input: { runId: string }): Promise<ReplayHistoryEntry | null>;
  startReplay(input: {
    projectionNames: string[];
    since: string;
    tenantIds: string[];
    aggregateIds?: string[];
    fullRebuild?: boolean;
    description: string;
    userName: string;
  }): Promise<{ runId: string }>;
  getStatus(): Promise<ReplayStatus>;
  cancelReplay(): Promise<{ cancelled: boolean }>;
};

/**
 * The operations capability as the process composes it: the portable service
 * plus the explorers, the replay runner and the optional snapshot collector.
 */
export type OpsCapability = OpsService & {
  eventExplorer: OpsEventExplorer;
  managerExplorer: OpsProcessExplorer;
  replay: OpsReplayRunner;
  snapshots: OpsSnapshotService | null;
};

/** What the process composes this feature's application from. */
export interface OpsAppDependencies {
  users: UserApiContract;
  auth: AuthApiContract;
  projects: ProjectApiContract;
  auditLog: AuditLogApiContract;
}

/** The process-owned adapters used to make one Ops capability at boot. */
/**
 * The in-place system migrations, as the process runs them.
 *
 * Infrastructure rather than a peer module: the runner is composed from the
 * process's own migration registry and its ledger, and it is the one thing on
 * this surface that no service of this module owns.
 */
export interface OpsSystemMigrationRunner {
  getOverview(): Promise<OpsMigrationOverview[]>;
  getEnrollments(input: { requestedBy: string }): Promise<OpsMigrationEnrollmentListing>;
  searchOrganizations(input: { query: string }): Promise<OpsMigrationOrganizationMatch[]>;
  /**
   * Whether this migration's blast radius earns the rollback's guard. The
   * migration's own declaration decides, so this gate and the page that asks
   * for the confirmation cannot drift apart.
   */
  requiresOperatorConfirmation(input: { migrationName: string }): boolean;
  enroll(input: {
    organizationId: string;
    migrationName: string;
    actorUserId: string;
  }): Promise<void>;
  enrollCohort(input: {
    migrationName: string;
    sampleSize: number;
    actorUserId: string;
    includeEnterprise: boolean;
    includePrivateDataplane: boolean;
  }): Promise<OpsMigrationCohortResult>;
  withdraw(input: {
    organizationId: string;
    migrationName: string;
    actorUserId: string;
  }): Promise<void>;
  runForOrganization(input: {
    organizationId: string;
    migrationName: string;
    actorUserId: string;
  }): Promise<OpsMigrationTargetedRunResult>;
  startPass(): void;
  assertLegacyWritersDrained(input: {
    migrationName: string;
    tenantId: string;
    minimumWriterGeneration: string;
    actorUserId: string;
  }): Promise<void>;
  rollBack(input: {
    migrationName: string;
    tenantId: string;
    actorUserId: string;
  }): Promise<void>;
}

/** Team alert for a filed report. Best-effort: intake already succeeded. */
export interface BugReportNotifier {
  notify(input: { report: BugReport }): Promise<void>;
}

/**
 * Fixed-window counter for the PUBLIC report endpoint. The bucket key is the
 * nearest-hop IP, which the caller asserts, so this is a flood bound rather
 * than an authorization: the deployment's own counter decides, and its absence
 * would let one client fill a cross-tenant inbox.
 */
export interface BugReportRateLimiter {
  consume(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<{ allowed: boolean }>;
}

/** The registered projections and event subscribers, as the process knows them. */
export interface OpsPipelineRegistry {
  listRegistrations(): OpsPipelineRegistrations;
}

/** The bound on an event-log search, as this deployment is configured. */
export interface OpsEventLogWindowReader {
  read(): OpsEventLogSearchWindow;
}

/** Grafana deep-link configuration, or null where no Grafana is configured. */
export interface OpsGrafanaLinks {
  findLinkConfig(): OpsGrafanaLinkConfig;
}

export interface OpsAppInfrastructure {
  createCapability(dependencies: OpsAppDependencies): OpsCapability;
  featureFlags: FeatureFlagApi;
  /**
   * The live pipeline graph, read for the kill-switch keys an operator may
   * set. Without it every generated key is unsettable.
   */
  eventingIntrospection: OpsEventingIntrospection;
  pipelines: OpsPipelineRegistry;
  eventLogWindow: OpsEventLogWindowReader;
  grafana: OpsGrafanaLinks;
  systemMigrations: OpsSystemMigrationRunner;
  bugReportRateLimiter: BugReportRateLimiter;
  bugReportNotifier: BugReportNotifier;
  /** The ClickHouse account an operator EXPLAIN runs as. */
  explainClients: OpsExplainClients;
  /**
   * The operator secret a caller presents, read PER REQUEST so a deployment
   * that rotates it without a restart is honoured. Null where this deployment
   * configured none, which refuses every call.
   */
  findOpsApiKey(): string | null;
  /**
   * Whether this deployment is production, for the explain service's own
   * fail-closed rule. Passed rather than read from the environment: a feature
   * package reads none.
   */
  isProduction: boolean;
  anomalyHardTierAlert: AnomalyHardTierAlert;
  opsReplayRuntime: OpsReplayRuntimeFactory;
  opsSnapshotRedis: OpsSnapshotRedis;
  opsWorker: OpsWorker;
  organizationDataplane: OrganizationDataplaneResolver;
  queuePayloadDecoder: QueuePayloadDecoder;
  schedulerWake: SchedulerWake;
  storageStatsMetrics: StorageStatsMetrics;
  usageStatsClickHouseClient: UsageStatsClickHouseClient;
  usageStatsClickHouseClientResolver: UsageStatsClickHouseClientResolver;
  usageStatsErrorReporter: UsageStatsErrorReporter;
  usageStatsTelemetryClient: UsageStatsTelemetryClient;
}
type OpsRuntimeDependencies = Readonly<{
  ops: OpsCapability;
  featureFlags: FeatureFlagApi;
  projects: ProjectApiContract;
  auditLog: AuditLogApiContract;
  apiKeys: ApiKeyApiContract;
  eventingIntrospection: OpsEventingIntrospection;
  pipelines: OpsPipelineRegistry;
  eventLogWindow: OpsEventLogWindowReader;
  grafana: OpsGrafanaLinks;
  systemMigrations: OpsSystemMigrationRunner;
  inbox: BugReportInboxService;
  intake: BugReportIntakeService;
  explain: OpsExplainService;
  findOpsApiKey(): string | null;
  isProduction: boolean;
}>;
type OpsSetup = FeatureSetup<
  typeof OpsApp.dependencies,
  OpsAppInfrastructure,
  undefined,
  OpsRepositories
>;

/** The badge's two integers, and when they were computed. */
export interface OpsBadgeReading {
  blockedCount: number;
  dlqCount: number;
  /** Null when no snapshot collector is running: "we cannot say", not "all clear". */
  computedAt: OpsApiGetBadgeCountsOutput["computedAt"];
}

/**
 * A destructive operator write reached the application without a session.
 *
 * Unreachable behind an authenticated procedure, and kept anyway: a guard
 * whose strictest branch is the one a missing session bypasses is fail-open in
 * shape, and this one stands in front of irreversible members work.
 */
export class OpsOperatorSessionRequiredError extends HandledError {
  declare readonly code: "ops_operator_session_required";

  constructor() {
    super("ops_operator_session_required", "This action needs a signed-in session.", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "OpsOperatorSessionRequiredError";
  }
}

/**
 * A destructive operator write was attempted from an impersonation session.
 *
 * The operator scope deliberately falls back to the impersonator's own grant,
 * so `ops:manage` is inherited by an impersonation session - and "acting as"
 * another user is the wrong posture for irreversible members surgery,
 * because the audit trail would name the impersonated account.
 */
export class OpsImpersonatedOperatorRefusedError extends HandledError {
  declare readonly code: "ops_impersonated_operator_refused";

  constructor() {
    super(
      "ops_impersonated_operator_refused",
      "This action cannot be run from an impersonated session. Sign in directly to continue.",
      { httpStatus: 403, fault: "customer" },
    );
    this.name = "OpsImpersonatedOperatorRefusedError";
  }
}

/**
 * A destructive operator write arrived without its typed confirmation.
 *
 * The damage these writes do is silent - deleting a blob completes the job
 * that referenced it without its handler ever running - so the confirmation is
 * what makes the act deliberate rather than a mis-click. The dialog in the ops
 * UI is not this guard: every one of these procedures is callable directly.
 */
export class OpsConfirmationRequiredError extends HandledError {
  declare readonly code: "ops_confirmation_required";

  constructor() {
    super("ops_confirmation_required", "This action needs to be confirmed before it can run", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "OpsConfirmationRequiredError";
  }
}

/**
 * A feature-flag write named a key the registry does not declare.
 *
 * Reads are deliberately permissive - the operator catalogue surfaces orphan
 * rows so they can be deleted - but a write to an unregistered key would store
 * a value nothing ever reads.
 */
export class OpsUnknownFeatureFlagError extends HandledError {
  declare readonly code: "ops_feature_flag_unknown";

  constructor(key: string) {
    super("ops_feature_flag_unknown", `Unknown feature flag key: ${key}`, {
      httpStatus: 400,
      fault: "customer",
      meta: { key },
    });
    this.name = "OpsUnknownFeatureFlagError";
  }
}

/**
 * Somebody who is not on the deployment's operator allow-list asked for an
 * operator surface.
 *
 * The whole platform tier is decided by that list rather than by an RBAC grain
 * an id in the input could be checked at, so the refusal is the module's and
 * not a scope decision the door could have made.
 */
export class OpsOperatorRequiredError extends HandledError {
  declare readonly code: "permission_denied";

  constructor(permission: OpsOperatorPermission) {
    super("permission_denied", "This is an operator-only surface.", {
      httpStatus: 403,
      fault: "customer",
      meta: { permission },
    });
    this.name = "OpsOperatorRequiredError";
  }
}

/** No operator secret was presented, or the presented one did not match. */
export class OpsOperatorSecretRequiredError extends HandledError {
  declare readonly code: "unauthorized";

  constructor() {
    super("unauthorized", "Unauthorized", { httpStatus: 401, fault: "customer" });
    this.name = "OpsOperatorSecretRequiredError";
  }
}

export class OpsApp implements OpsApi {
  static readonly contract = OpsApi;
  static readonly dependencies = {
    users: UserApi,
    auth: AuthApi,
    projects: ProjectApi,
    auditLog: AuditLogApi,
    apiKeys: ApiKeyApi,
  };
  static readonly configSchema = void 0;

  static create(setup: OpsSetup): OpsApp {
    const { members } = setup;

    const inbox = BugReportInboxService.create({ reports: setup.repositories.bugReports });

    return new OpsApp({
      ops: members.createCapability(setup.dependencies),
      inbox,
      intake: BugReportIntakeService.create({
        reports: setup.repositories.bugReports,
        rateLimiter: members.bugReportRateLimiter,
        notifier: members.bugReportNotifier,
      }),
      apiKeys: setup.dependencies.apiKeys,
      featureFlags: members.featureFlags,
      projects: setup.dependencies.projects,
      auditLog: setup.dependencies.auditLog,
      eventingIntrospection: members.eventingIntrospection,
      pipelines: members.pipelines,
      eventLogWindow: members.eventLogWindow,
      grafana: members.grafana,
      systemMigrations: members.systemMigrations,
      explain: OpsExplainService.create({
        repository: OpsExplainClickHouseRepository.create({
          resolver: members.explainClients,
        }),
      }),
      findOpsApiKey: () => members.findOpsApiKey(),
      isProduction: members.isProduction,
    });
  }

  readonly #dependencies: OpsRuntimeDependencies;

  private constructor(dependencies: OpsRuntimeDependencies) {
    this.#dependencies = dependencies;
  }

  /**
   * Whether this identity is on the deployment's operator allow-list.
   *
   * Synchronous, and keyed on the identity's email rather than a user id —
   * `OpsApi.isAdmin(identity: AdminIdentity)` is the contract, and the
   * allow-list is a list of addresses. Lifted onto the application because a
   * door outside this feature asks it: the SSO connection surface gates on the
   * staff list rather than on `ops:*`, and it reaches this answer through the
   * same slice.
   */
  isAdmin(identity: AdminIdentity): boolean {
    return this.#dependencies.ops.isAdmin(identity);
  }

  // -- the rules the transport used to hold ----------------------------------

  /**
   * The extra gate on an operator write whose damage nobody would notice in
   * time: a real signed-in operator, not an impersonation, and a typed
   * confirmation.
   *
   * `ops:manage` already resolves through the admin allow-list, but it is not
   * enough on its own: it is inherited by an impersonation session, and the
   * damage is silent - pinning an organization back onto the legacy
   * authorization path changes which tables answer every permission check for
   * that tenant without failing anything.
   *
   * Eight procedures called this, and it lives here rather than in the
   * transport so a ninth cannot quietly answer a different question.
   */
  requireDestructiveOperator(operator: OpsOperator | null, confirmation: string | undefined): void {
    if (!operator) throw new OpsOperatorSessionRequiredError();
    if (operator.impersonator) throw new OpsImpersonatedOperatorRefusedError();
    if (!confirmation) throw new OpsConfirmationRequiredError();
  }

  /** The collected dashboard, or null when no snapshot collector is running. */
  findDashboardData(): DashboardData | null {
    return this.#dependencies.ops.snapshots?.findDashboardData() ?? null;
  }

  /**
   * The two integers the global ops badge renders.
   *
   * Without a snapshot collector the counts are zero and `computedAt` is null,
   * because these zeroes are "we cannot say" rather than "nothing is wrong" —
   * stamping the current time would present unavailable data as a fresh
   * all-clear. Same shape either way, so no caller branches on whether the
   * field exists.
   */
  badgeCounts(): OpsBadgeReading {
    const snapshots = this.#dependencies.ops.snapshots;
    if (!snapshots) return { blockedCount: 0, dlqCount: 0, computedAt: null };
    return snapshots.getBadgeCounts();
  }

  /** The live dashboard feed. Yields nothing when no collector is running. */
  async *streamDashboard(
    input: Parameters<OpsSnapshotService["streamDashboard"]>[0],
  ): AsyncIterable<DashboardData> {
    const snapshots = this.#dependencies.ops.snapshots;
    if (!snapshots) return;
    yield* snapshots.streamDashboard(input);
  }

  /** One queue group, raising a not-found rather than answering null. */
  async getQueueGroup(input: { queueName: string; groupId: string }): Promise<GroupInfo> {
    const group = await this.#dependencies.ops.findQueueGroup(input);
    if (!group) {
      throw new NotFoundError("not_found", "Queue group", input.groupId, {
        meta: { queueName: input.queueName },
      });
    }
    return group;
  }

  /**
   * One aggregate's state under one projection, at one event index.
   *
   * An answer with no `aggregateType` means the projection name matched
   * nothing, which is a not-found rather than a half-filled result the caller
   * has to inspect.
   */
  async computeProjectionState(input: {
    aggregateId: string;
    tenantId: string;
    projectionName: string;
    eventIndex: number;
  }): Promise<ProjectionStateAtEvent> {
    const state = await this.#dependencies.ops.eventExplorer.computeProjectionState(input);
    if (!state.aggregateType) {
      throw new NotFoundError("not_found", "Projection", input.projectionName);
    }
    return state;
  }

  /** Currently-active tenant anomalies, hard tier first. */
  listAnomalies(): Promise<Anomaly[]> {
    return this.#dependencies.ops.listAnomalies();
  }

  /** Dismisses one tenant anomaly. */
  dismissAnomaly(input: { tenantId: string; kind: AnomalyKind }): Promise<boolean> {
    return this.#dependencies.ops.dismissAnomaly(input);
  }

  /** The project lookup behind the operator's tenant pickers. */
  searchProjects(input: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]> {
    return this.#dependencies.projects.searchByQuery(input);
  }

  // -- feature flags ---------------------------------------------------------

  /**
   * Every operator-visible flag: the registry, orphan stored rows, and every
   * kill switch the live pipeline graph will read even before anyone has
   * flipped it.
   */
  async featureFlagCatalogue(): Promise<OperatorFeatureFlagCatalogue> {
    return withKillSwitchDescriptors({
      catalogue: await this.#dependencies.featureFlags.listOperatorCatalogue(),
      descriptors: this.#dependencies.eventingIntrospection.killSwitches(),
    });
  }

  /** Turns one registered flag on or off. */
  async setFeatureFlagEnabled(input: {
    key: string;
    enabled: boolean;
    lastEditedBy: string | null;
  }): Promise<void> {
    this.requireRegisteredFlag(input.key);
    await this.#dependencies.featureFlags.setEnabled(input);
  }

  /** Replaces one registered flag's targeting rules. */
  async setFeatureFlagRules(input: {
    key: string;
    rules: FeatureFlagRules;
    lastEditedBy: string | null;
  }): Promise<void> {
    this.requireRegisteredFlag(input.key);
    await this.#dependencies.featureFlags.setRules(input);
  }

  /**
   * Deletes a stored flag row.
   *
   * Deliberately permissive about the key: the operator catalogue surfaces
   * orphan rows - keys that no longer match the registry or the pipeline graph
   * - so operators can delete them, and validating the key here would break
   * exactly that cleanup path.
   */
  clearFeatureFlag(input: { key: string; lastEditedBy: string | null }): Promise<void> {
    return this.#dependencies.featureFlags.clearStoredFlag(input);
  }

  discoverAggregates(input: Parameters<OpsEventExplorer["discoverAggregates"]>[0]) {
    return this.#dependencies.ops.eventExplorer.discoverAggregates(input);
  }

  /**
   * The event-log search. A caller naming no lower bound gets the explorer's
   * own default lookback, which lives here so two doors cannot disagree about
   * how far back the same question reaches.
   */
  searchAggregates(input: {
    query: string;
    tenantIds: string[];
    sinceMs?: number | undefined;
  }): Promise<AggregateSearchResult[]> {
    return this.#dependencies.ops.eventExplorer.searchAggregates({
      query: input.query,
      tenantIds: input.tenantIds,
      sinceMs: input.sinceMs ?? nowInstant().epochMilliseconds - EVENT_LOG_SEARCH_LOOKBACK_MS,
    });
  }

  getAggregateEvents(input: Parameters<OpsEventExplorer["getAggregateEvents"]>[0]) {
    return this.#dependencies.ops.eventExplorer.getAggregateEvents(input);
  }

  getForAggregate(input: Parameters<OpsProcessExplorer["getForAggregate"]>[0]) {
    return this.#dependencies.ops.managerExplorer.getForAggregate(input);
  }

  requeueDeadMessages(input: Parameters<OpsProcessExplorer["requeueDeadMessages"]>[0]) {
    return this.#dependencies.ops.managerExplorer.requeueDeadMessages(input);
  }

  getFleetSummary() {
    return this.#dependencies.ops.managerExplorer.getFleetSummary();
  }
  getDeadLetters(input: Parameters<OpsProcessExplorer["getDeadLetters"]>[0]) {
    return this.#dependencies.ops.managerExplorer.getDeadLetters(input);
  }
  getDeadLetterCounts() {
    return this.#dependencies.ops.managerExplorer.getDeadLetterCounts();
  }
  getInstances(input: Parameters<OpsProcessExplorer["getInstances"]>[0]) {
    return this.#dependencies.ops.managerExplorer.getInstances(input);
  }
  getUpcomingWakes(input: Parameters<OpsProcessExplorer["getUpcomingWakes"]>[0]) {
    return this.#dependencies.ops.managerExplorer.getUpcomingWakes(input);
  }
  findInstanceDetail(input: Parameters<OpsProcessExplorer["findInstanceDetail"]>[0]) {
    return this.#dependencies.ops.managerExplorer.findInstanceDetail(input);
  }
  getOutbox(input: Parameters<OpsProcessExplorer["getOutbox"]>[0]) {
    return this.#dependencies.ops.managerExplorer.getOutbox(input);
  }
  listRecentActions(input: Parameters<OpsProcessExplorer["listRecentActions"]>[0]) {
    return this.#dependencies.ops.managerExplorer.listRecentActions(input);
  }
  wakeNow(input: Parameters<OpsProcessExplorer["wakeNow"]>[0]) {
    return this.#dependencies.ops.managerExplorer.wakeNow(input);
  }
  redriveDeadInstance(input: Parameters<OpsProcessExplorer["redriveDeadInstance"]>[0]) {
    return this.#dependencies.ops.managerExplorer.redriveDeadInstance(input);
  }
  redriveDeadMessage(input: Parameters<OpsProcessExplorer["redriveDeadMessage"]>[0]) {
    return this.#dependencies.ops.managerExplorer.redriveDeadMessage(input);
  }
  discardDeadMessage(input: Parameters<OpsProcessExplorer["discardDeadMessage"]>[0]) {
    return this.#dependencies.ops.managerExplorer.discardDeadMessage(input);
  }
  redriveDeadLetters(input: Parameters<OpsProcessExplorer["redriveDeadLetters"]>[0]) {
    return this.#dependencies.ops.managerExplorer.redriveDeadLetters(input);
  }
  discardDeadLetters(input: Parameters<OpsProcessExplorer["discardDeadLetters"]>[0]) {
    return this.#dependencies.ops.managerExplorer.discardDeadLetters(input);
  }
  getOutboxAttempts(input: Parameters<OpsProcessExplorer["getOutboxAttempts"]>[0]) {
    return this.#dependencies.ops.managerExplorer.getOutboxAttempts(input);
  }
  releaseLapsedLease(input: Parameters<OpsProcessExplorer["releaseLapsedLease"]>[0]) {
    return this.#dependencies.ops.managerExplorer.releaseLapsedLease(input);
  }
  getHistory() {
    return this.#dependencies.ops.replay.getHistory();
  }
  findHistoryEntry(input: Parameters<OpsReplayRunner["findHistoryEntry"]>[0]) {
    return this.#dependencies.ops.replay.findHistoryEntry(input);
  }
  startReplay(input: Parameters<OpsReplayRunner["startReplay"]>[0]) {
    return this.#dependencies.ops.replay.startReplay(input);
  }
  getStatus() {
    return this.#dependencies.ops.replay.getStatus();
  }
  cancelReplay() {
    return this.#dependencies.ops.replay.cancelReplay();
  }

  startImpersonation(input: Parameters<OpsService["startImpersonation"]>[0]) {
    return this.#dependencies.ops.startImpersonation(input);
  }
  stopImpersonation(input: Parameters<OpsService["stopImpersonation"]>[0]) {
    return this.#dependencies.ops.stopImpersonation(input);
  }
  adminOperation(input: Parameters<OpsService["adminOperation"]>[0]) {
    return this.#dependencies.ops.adminOperation(input);
  }
  listBlobQueues() {
    return this.#dependencies.ops.listBlobQueues();
  }
  getBlobStoreStats() {
    return this.#dependencies.ops.getBlobStoreStats();
  }
  listBlobs(input: Parameters<OpsService["listBlobs"]>[0]) {
    return this.#dependencies.ops.listBlobs(input);
  }
  findBlob(input: Parameters<OpsService["findBlob"]>[0]) {
    return this.#dependencies.ops.findBlob(input);
  }
  runBlobCleanup(input: Parameters<OpsService["runBlobCleanup"]>[0]) {
    return this.#dependencies.ops.runBlobCleanup(input);
  }
  deleteBlob(input: Parameters<OpsService["deleteBlob"]>[0]) {
    return this.#dependencies.ops.deleteBlob(input);
  }
  listScheduledJobs(input: Parameters<OpsService["listScheduledJobs"]>[0]) {
    return this.#dependencies.ops.listScheduledJobs(input);
  }
  setScheduleActive(input: Parameters<OpsService["setScheduleActive"]>[0]) {
    return this.#dependencies.ops.setScheduleActive(input);
  }
  clearStuckScheduleSlot(input: Parameters<OpsService["clearStuckScheduleSlot"]>[0]) {
    return this.#dependencies.ops.clearStuckScheduleSlot(input);
  }
  runScheduleNow(input: Parameters<OpsService["runScheduleNow"]>[0]) {
    return this.#dependencies.ops.runScheduleNow(input);
  }
  listQueues() {
    return this.#dependencies.ops.listQueues();
  }
  getBlockedQueueSummary() {
    return this.#dependencies.ops.getBlockedQueueSummary();
  }
  listAllQueueDlqGroups() {
    return this.#dependencies.ops.listAllQueueDlqGroups();
  }
  pauseQueuePipeline(input: Parameters<OpsService["pauseQueuePipeline"]>[0]) {
    return this.#dependencies.ops.pauseQueuePipeline(input);
  }
  unpauseQueuePipeline(input: Parameters<OpsService["unpauseQueuePipeline"]>[0]) {
    return this.#dependencies.ops.unpauseQueuePipeline(input);
  }
  listPausedQueueKeys(input: Parameters<OpsService["listPausedQueueKeys"]>[0]) {
    return this.#dependencies.ops.listPausedQueueKeys(input);
  }
  pauseQueueTenant(input: Parameters<OpsService["pauseQueueTenant"]>[0]) {
    return this.#dependencies.ops.pauseQueueTenant(input);
  }
  unpauseQueueTenant(input: Parameters<OpsService["unpauseQueueTenant"]>[0]) {
    return this.#dependencies.ops.unpauseQueueTenant(input);
  }
  listPausedQueueTenants(input: Parameters<OpsService["listPausedQueueTenants"]>[0]) {
    return this.#dependencies.ops.listPausedQueueTenants(input);
  }
  listQueueDlqGroups(input: Parameters<OpsService["listQueueDlqGroups"]>[0]) {
    return this.#dependencies.ops.listQueueDlqGroups(input);
  }
  discoverQueueNames() {
    return this.#dependencies.ops.discoverQueueNames();
  }
  scanQueues(input: Parameters<OpsService["scanQueues"]>[0]) {
    return this.#dependencies.ops.scanQueues(input);
  }
  readQueuePendingDrift(input: Parameters<OpsService["readQueuePendingDrift"]>[0]) {
    return this.#dependencies.ops.readQueuePendingDrift(input);
  }
  listPausedSchedules(input: Parameters<OpsService["listPausedSchedules"]>[0]) {
    return this.#dependencies.ops.listPausedSchedules(input);
  }
  listSchedulerActions(input: Parameters<OpsService["listSchedulerActions"]>[0]) {
    return this.#dependencies.ops.listSchedulerActions(input);
  }
  listQueueGroups(input: Parameters<OpsService["listQueueGroups"]>[0]) {
    return this.#dependencies.ops.listQueueGroups(input);
  }
  findQueueGroup(input: Parameters<OpsService["findQueueGroup"]>[0]) {
    return this.#dependencies.ops.findQueueGroup(input);
  }
  listQueueGroupJobs(input: Parameters<OpsService["listQueueGroupJobs"]>[0]) {
    return this.#dependencies.ops.listQueueGroupJobs(input);
  }
  listParkedQueueGroups(input: Parameters<OpsService["listParkedQueueGroups"]>[0]) {
    return this.#dependencies.ops.listParkedQueueGroups(input);
  }
  unblockQueueGroup(input: Parameters<OpsService["unblockQueueGroup"]>[0]) {
    return this.#dependencies.ops.unblockQueueGroup(input);
  }
  unblockAllQueueGroups(input: Parameters<OpsService["unblockAllQueueGroups"]>[0]) {
    return this.#dependencies.ops.unblockAllQueueGroups(input);
  }
  drainQueueGroup(input: Parameters<OpsService["drainQueueGroup"]>[0]) {
    return this.#dependencies.ops.drainQueueGroup(input);
  }
  retryBlockedQueueJob(input: Parameters<OpsService["retryBlockedQueueJob"]>[0]) {
    return this.#dependencies.ops.retryBlockedQueueJob(input);
  }
  drainQueueTenant(input: Parameters<OpsService["drainQueueTenant"]>[0]) {
    return this.#dependencies.ops.drainQueueTenant(input);
  }
  moveQueueGroupToDlq(input: Parameters<OpsService["moveQueueGroupToDlq"]>[0]) {
    return this.#dependencies.ops.moveQueueGroupToDlq(input);
  }
  moveAllBlockedQueueGroupsToDlq(
    input: Parameters<OpsService["moveAllBlockedQueueGroupsToDlq"]>[0],
  ) {
    return this.#dependencies.ops.moveAllBlockedQueueGroupsToDlq(input);
  }
  replayQueueGroupFromDlq(input: Parameters<OpsService["replayQueueGroupFromDlq"]>[0]) {
    return this.#dependencies.ops.replayQueueGroupFromDlq(input);
  }
  replayAllQueueGroupsFromDlq(input: Parameters<OpsService["replayAllQueueGroupsFromDlq"]>[0]) {
    return this.#dependencies.ops.replayAllQueueGroupsFromDlq(input);
  }
  redriveQueueDlqGroups(input: Parameters<OpsService["redriveQueueDlqGroups"]>[0]) {
    return this.#dependencies.ops.redriveQueueDlqGroups(input);
  }
  discardQueueDlqGroups(input: Parameters<OpsService["discardQueueDlqGroups"]>[0]) {
    return this.#dependencies.ops.discardQueueDlqGroups(input);
  }
  canaryRedriveQueueDlq(input: Parameters<OpsService["canaryRedriveQueueDlq"]>[0]) {
    return this.#dependencies.ops.canaryRedriveQueueDlq(input);
  }
  canaryUnblockQueueGroups(input: Parameters<OpsService["canaryUnblockQueueGroups"]>[0]) {
    return this.#dependencies.ops.canaryUnblockQueueGroups(input);
  }
  getQueueDrainPreview(input: Parameters<OpsService["getQueueDrainPreview"]>[0]) {
    return this.#dependencies.ops.getQueueDrainPreview(input);
  }
  tryReconcileQueuePending(input: Parameters<OpsService["tryReconcileQueuePending"]>[0]) {
    return this.#dependencies.ops.tryReconcileQueuePending(input);
  }
  listParkedQueueTenants(input: Parameters<OpsService["listParkedQueueTenants"]>[0]) {
    return this.#dependencies.ops.listParkedQueueTenants(input);
  }

  // -- the platform-tier gate ------------------------------------------------

  /**
   * The caller's operator reach, as an answer rather than a refusal: the
   * global menu polls it on every page load, so a non-operator gets
   * `{ kind: "none" }` and not a console full of errors (lw#3584).
   */
  operatorScope(operator: OpsOperator | null): OpsScope {
    return this.#operatorOf(operator) ? { kind: "platform" } : { kind: "none" };
  }

  /**
   * The one gate every operator procedure passes. Platform-tier: it resolves
   * the deployment's own allow-list and reads no id from the request, because
   * there is no scope an operator surface could be checked at. A write whose
   * damage nobody would notice in time passes a second gate as well.
   */
  admitOperator(operator: OpsOperator | null, permission: OpsOperatorPermission): void {
    if (!this.#operatorOf(operator)) throw new OpsOperatorRequiredError(permission);
  }

  /**
   * The staff gate on the support inbox. The same allow-list, named for what
   * it decides there: a bug report carries no tenant, so staff is the only
   * question that could be asked about it.
   */
  admitStaff(operator: OpsOperator | null): OpsOperator {
    if (!this.#operatorOf(operator)) throw new OpsOperatorRequiredError("ops:view");

    return actingIdentityOf(operator);
  }

  /**
   * The same list, refused the back office's way: not-found rather than
   * forbidden, so a probe learns nothing about whether the surface exists.
   */
  admitBackOfficeStaff(operator: OpsOperator | null): OpsOperator {
    if (!this.#operatorOf(operator)) throw new AdminSurfaceHiddenError();

    return actingIdentityOf(operator);
  }

  /**
   * The acting operator, or nothing where the caller is not on the list. An
   * impersonating operator is read as the operator: somebody debugging a
   * customer account is still staff, and the list matches the ADDRESS.
   */
  #operatorOf(operator: OpsOperator | null): OpsOperator | null {
    if (!operator) return null;

    return this.isAdmin(actingIdentityOf(operator)) ? operator : null;
  }

  // -- the operator-only ClickHouse EXPLAIN ----------------------------------

  /**
   * The operator secret, compared in constant time. A deployment that
   * configured none refuses every call: a blank expected secret must never
   * match a blank presented one.
   */
  authorizeOperatorSecret(input: { presented: string | null }): void {
    const expected = this.#dependencies.findOpsApiKey();

    if (!expected || !input.presented) throw new OpsOperatorSecretRequiredError();

    const presented = Buffer.from(input.presented);
    const secret = Buffer.from(expected);

    if (presented.length !== secret.length) throw new OpsOperatorSecretRequiredError();
    if (!timingSafeEqual(presented, secret)) throw new OpsOperatorSecretRequiredError();
  }

  /** One EXPLAIN, wrapped so it cannot execute, audited by its shape. */
  async explainClickHouseQuery(input: OpsExplainRequest): Promise<OpsExplainAnswer> {
    const built = buildExplainQuery(input.query, input.type);

    if (!built.wrapped || !built.type) {
      return { status: "refused", reason: built.reason ?? "invalid query" };
    }

    const outcome = await this.#dependencies.explain.explain({
      wrappedQuery: built.wrapped,
      type: built.type,
      isProduction: this.#dependencies.isProduction,
      auditFields: redactQueryForAudit(input.query),
    });

    if (outcome.status === "ok") return { status: "ok", type: built.type, rows: outcome.rows };
    // The engine's own prose names cluster internals; the explain service logs it.
    if (outcome.status === "error") return { status: "failed" };

    return outcome;
  }

  // -- the process's own readings --------------------------------------------

  listPipelineRegistrations(): OpsPipelineRegistrations {
    return this.#dependencies.pipelines.listRegistrations();
  }

  getEventLogSearchWindow(): OpsEventLogSearchWindow {
    return this.#dependencies.eventLogWindow.read();
  }

  findGrafanaLinkConfig(): OpsGrafanaLinkConfig {
    return this.#dependencies.grafana.findLinkConfig();
  }

  // -- in-place system migrations --------------------------------------------

  listSystemMigrations(): Promise<OpsMigrationOverview[]> {
    return this.#dependencies.systemMigrations.getOverview();
  }

  listMigrationEnrollments(input: { requestedBy: string }): Promise<OpsMigrationEnrollmentListing> {
    return this.#dependencies.systemMigrations.getEnrollments(input);
  }

  searchMigrationOrganizations(input: {
    query: string;
  }): Promise<OpsMigrationOrganizationMatch[]> {
    return this.#dependencies.systemMigrations.searchOrganizations(input);
  }

  async enrollMigrationTenant(input: {
    organizationId: string;
    migrationName: string;
    operator: OpsOperator | null;
    confirm?: string | undefined;
  }): Promise<void> {
    const actorUserId = this.#confirmedMigrationActor(input);

    await this.#dependencies.systemMigrations.enroll({
      organizationId: input.organizationId,
      migrationName: input.migrationName,
      actorUserId,
    });
  }

  enrollMigrationCohort(input: {
    migrationName: string;
    sampleSize: number;
    includeEnterprise: boolean;
    includePrivateDataplane: boolean;
    operator: OpsOperator | null;
    confirm?: string | undefined;
  }): Promise<OpsMigrationCohortResult> {
    const actorUserId = this.#confirmedMigrationActor(input);

    return this.#dependencies.systemMigrations.enrollCohort({
      migrationName: input.migrationName,
      sampleSize: input.sampleSize,
      includeEnterprise: input.includeEnterprise,
      includePrivateDataplane: input.includePrivateDataplane,
      actorUserId,
    });
  }

  withdrawMigrationTenant(input: {
    organizationId: string;
    migrationName: string;
    actorUserId: string;
  }): Promise<void> {
    return this.#dependencies.systemMigrations.withdraw(input);
  }

  runSystemMigrationForOrganization(input: {
    organizationId: string;
    migrationName: string;
    operator: OpsOperator | null;
    confirm?: string | undefined;
  }): Promise<OpsMigrationTargetedRunResult> {
    const actorUserId = this.#confirmedMigrationActor(input);

    return this.#dependencies.systemMigrations.runForOrganization({
      organizationId: input.organizationId,
      migrationName: input.migrationName,
      actorUserId,
    });
  }

  runSystemMigrationPass(): void {
    this.#dependencies.systemMigrations.startPass();
  }

  async assertSystemMigrationLegacyWritersDrained(input: {
    migrationName: string;
    tenantId: string;
    minimumWriterGeneration: string;
    operator: OpsOperator | null;
    confirm?: string | undefined;
  }): Promise<void> {
    this.requireDestructiveOperator(input.operator ?? null, input.confirm);

    await this.#dependencies.systemMigrations.assertLegacyWritersDrained({
      migrationName: input.migrationName,
      tenantId: input.tenantId,
      minimumWriterGeneration: input.minimumWriterGeneration,
      actorUserId: this.#actorIdOf(input.operator),
    });
  }

  /**
   * Pin a migrated or finalized organization back onto its legacy path. Same
   * posture as the blob-store writes: callable without the dialog, and it
   * decides which tables answer an entire organization's permission checks.
   */
  async rollBackSystemMigrationTenant(input: {
    migrationName: string;
    tenantId: string;
    operator: OpsOperator | null;
    confirm?: string | undefined;
  }): Promise<void> {
    this.requireDestructiveOperator(input.operator ?? null, input.confirm);

    await this.#dependencies.systemMigrations.rollBack({
      migrationName: input.migrationName,
      tenantId: input.tenantId,
      actorUserId: this.#actorIdOf(input.operator),
    });
  }

  /**
   * The confirmation gate the migration itself declares, and the actor the
   * enrollment is attributed to. Which migrations are guarded comes from their
   * own declaration, so this gate and the page asking cannot drift apart.
   */
  #confirmedMigrationActor(input: {
    migrationName: string;
    operator: OpsOperator | null;
    confirm?: string | undefined;
  }): string {
    const guarded = this.#dependencies.systemMigrations.requiresOperatorConfirmation({
      migrationName: input.migrationName,
    });

    if (guarded) this.requireDestructiveOperator(input.operator ?? null, input.confirm);

    return this.#actorIdOf(input.operator);
  }

  /** The opaque id a migration write is attributed to. */
  #actorIdOf(operator: OpsOperator | null): string {
    if (!operator) throw new OpsOperatorSessionRequiredError();

    return operator.id;
  }

  // -- the support inbox -----------------------------------------------------

  async listBugReports(
    input: ListBugReportsInput & { actorUserId: string },
  ): Promise<BugReportListing> {
    await this.#recordBugReportRead({
      actorUserId: input.actorUserId,
      action: "bugReports.getAll",
      // Never the raw search text: contact searches are email addresses, and
      // audit rows outlive the inbox.
      args: {
        page: input.page,
        pageSize: input.pageSize,
        hasSearch: Boolean(input.search),
      },
    });

    return this.#dependencies.inbox.getAll({
      page: input.page,
      pageSize: input.pageSize,
      search: input.search,
    });
  }

  async getBugReport(input: { id: string; actorUserId: string }): Promise<BugReport> {
    await this.#recordBugReportRead({
      actorUserId: input.actorUserId,
      action: "bugReports.getById",
      targetId: input.id,
    });

    const report = await this.#dependencies.inbox.findById({ id: input.id });

    if (!report) throw new NotFoundError("not_found", "Report", input.id);

    return report;
  }

  /**
   * File one report from a customer's coding agent. Unauthenticated on
   * purpose: the reporter may be struggling because setup failed, so a report
   * must never require a working login. A credential only enriches it.
   */
  submitBugReport(input: {
    report: SubmitBugReport;
    callerKey: string;
    apiToken?: string | undefined;
    projectIdHint?: string | null;
  }): Promise<{ id: string }> {
    return this.#dependencies.intake.submit({
      input: input.report,
      callerKey: input.callerKey,
      apiToken: input.apiToken,
      projectIdHint: input.projectIdHint,
      apiKeys: this.#dependencies.apiKeys,
    });
  }

  /**
   * Written BEFORE the answer, and awaited: reports carry reporter-submitted
   * transcripts and contact addresses, so who opened one is itself a fact
   * worth keeping.
   */
  async #recordBugReportRead(entry: {
    actorUserId: string;
    action: string;
    args?: RecordAuditLogCommand["args"];
    targetId?: string;
  }): Promise<void> {
    await this.#dependencies.auditLog.record({
      userId: entry.actorUserId,
      action: entry.action,
      ...(entry.args === undefined ? {} : { args: entry.args }),
      targetKind: BUG_REPORT_TARGET_KIND,
      ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
    });
  }

  /**
   * Writes reach explicit registry entries and the kill-switch keys the live
   * pipeline graph advertises, and nothing else: family-prefix matching alone
   * would let a typo store an orphan row that never affects anything.
   */
  private requireRegisteredFlag(key: string): void {
    if (listFeatureFlags().some((flag) => flag.key === key)) return;
    if (this.#dependencies.eventingIntrospection.killSwitches().some((d) => d.key === key)) return;
    throw new OpsUnknownFeatureFlagError(key);
  }
}

/** External alert delivery for a newly surfaced hard-tier anomaly. */
export interface AnomalyHardTierAlert {
  notify(anomaly: Anomaly): Promise<void>;
}

/**
 * The live pipeline surface the ops explorers read.
 *
 * The application derived these off a module-global registry backed by
 * `getApp().eventSourcing.definitions`; a package may not reach a process
 * global, so the walk is an adapter over the definitions the composition
 * already holds and this is the seam the explorers take.
 */
export interface OpsProjectionMetadata {
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  source: "pipeline" | "global";
  pauseKey: string;
  kind: "fold" | "map" | "state";
}

export interface OpsProcessManagerMetadata {
  processName: string;
  pipelineName: string;
  aggregateType: string;
  /** Event types that drive the machine's transitions. */
  eventTypes: readonly string[];
  /**
   * Intent types the machine can emit — its cross-aggregate commands,
   * dispatched through the transactional outbox.
   */
  intentTypes: string[];
  /**
   * True for a fixed-interval singleton (one instance, project `__global__`);
   * false for a per-aggregate machine keyed by aggregate id.
   */
  scheduled: boolean;
  /** Fixed wake interval in ms for a scheduled singleton, else null. */
  everyMs: number | null;
  /** True when the machine computes its own wake-ups from within `evolve`. */
  hasWake: boolean;
}

export interface OpsDejaViewProjection {
  projectionName: string;
  eventTypes: readonly string[];
  init: () => unknown;
  apply: (state: unknown, event: { type: string }) => unknown;
}

/**
 * One togglable kill switch the live pipeline graph will read at runtime.
 * Advertised before any row exists, because a write refuses a key that is
 * neither a registry entry nor a live descriptor.
 */
export interface OpsKillSwitchDescriptor {
  key: string;
  aggregateType: string;
  componentType: "projection" | "mapProjection" | "command" | "subscriber";
  componentName: string;
  pipelineName: string;
}


export interface OpsEventingIntrospection {
  /** Every fold, map and state projection mounted across the pipelines. */
  projections(): OpsProjectionMetadata[];

  /** Every kill-switch key the mounted components will consult at runtime. */
  killSwitches(): OpsKillSwitchDescriptor[];

  /** The process-manager state machines mounted across the pipelines. */
  processManagers(): OpsProcessManagerMetadata[];

  /**
   * The fold projections a DejaView replay can re-run in memory, carrying
   * their `init`/`apply` so the explorer can rebuild state without a store.
   */
  dejaViewProjections(): OpsDejaViewProjection[];
}


export interface OpsSnapshotRedis {
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
  set(
    key: string,
    value: string,
    expiryMode: "EX",
    expirySeconds: number,
    condition: "NX",
  ): Promise<unknown>;
  tryGet(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
}

export interface OpsWorkerHandle {
  stop(): void | Promise<void>;
}

export interface UsageStatsWorkerConfig {
  disabled: boolean;
  installMethod: string;
  hostname: string | undefined;
  environment: string | undefined;
  now: () => Instant;
}

/** Process controls for the complete Ops worker graph. */
export interface OpsWorker {
  tryStartAnomalyWorker(): OpsWorkerHandle | undefined;
  tryStartUsageStatsWorker(): OpsWorkerHandle | undefined;
  /**
   * The fleet's queue-metrics writer. One process publishes the snapshot every other one reads, so
   * the handle's `stop` hands the lease back rather than letting the fleet wait out its TTL.
   */
  tryStartQueueMetricsWriter(): OpsWorkerHandle | undefined;
}

/**
 * Where one organization's data lives.
 *
 * The answer used to decide whether an organization ran at all, which on the
 * automatic axis would have stranded exactly the private-dataplane customers
 * on the legacy path forever.
 *
 * It decides nothing now. These migrations are rooted in the organization and
 * the routing places an organization-rooted append on that organization's own
 * instance, so the dataplane is what a pass REPORTS, not what it filters by.
 */
export type OrganizationDataplane =
  | Readonly<{ kind: "shared" }>
  | Readonly<{ kind: "private"; endpoint: string }>;


export interface OrganizationDataplaneResolver {
  /**
   * Synchronous: the routing table is an environment fact read once at boot,
   * so a pass that asks per organization must not pay a round trip for it.
   */
  dataplaneFor(organizationId: string): OrganizationDataplane;
}


export interface QueuePayloadDecoder {
  tryDecode(input: {
    queueName: string;
    value: string;
  }): Promise<Record<string, unknown> | null>;
}

/**
 * One replay run's engine, built fresh per run: its own Redis connection, its
 * own ClickHouse readers and the projections it can rebuild.
 */
export interface OpsReplayRuntime {
  service: EventingReplayService;
  projections: RegisteredFoldProjection[];
  mapProjections: RegisteredMapProjection[];
  /**
   * Discovered Postgres operational state projections, carrying their
   * definition and store for a paused, from-init canonical rebuild.
   */
  stateProjections: RegisteredStateProjection[];
  close: () => Promise<void>;
}

/**
 * Builds the runtime a replay run drives. The engine reaches the deployment's
 * ClickHouse resolver, its Redis and every feature's projection stores, so the
 * composition owns it; ops owns when a replay starts, what it covers and how it
 * is reported.
 *
 * `create` THROWS when the deployment cannot serve a replay (no Redis, no
 * ClickHouse route). `ReplayService` finalises the run with that message rather
 * than leaving a lock held on a run that never began.
 */
export interface OpsReplayRuntimeFactory {
  create(): OpsReplayRuntime;
}

/** Wakes the scheduler loop after an operator makes work due. */
export interface SchedulerWake {
  wake(): void;
}

/**
 * Where a storage-stats tick writes what it read.
 */
export interface StorageStatsMetrics {
  /** Clears the per-table and per-disk series this tick is about to rewrite. */
  beginTick(instance: string): void;

  recordTable(input: {
    instance: string;
    table: string;
    rows: number;
    bytes: number;
    parts: number;
  }): void;

  recordDisk(input: {
    instance: string;
    disk: string;
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
  }): void;

  recordBackupStatus(input: { instance: string; status: string; count: number }): void;

  recordLastBackup(input: {
    instance: string;
    succeededAtSeconds: number;
    sizeBytes: number;
  }): void;
}

export interface UsageStatsOrganization {
  id: string;
  name: string;
}

export interface UsageStatsProjectCounts {
  projectIds: string[];
  annotations: number;
  annotationQueues: number;
  annotationQueueItems: number;
  annotationScores: number;
  batchEvaluations: number;
  customGraphs: number;
  datasets: number;
  datasetRecords: number;
  experiments: number;
  triggers: number;
  workflows: number;
}

export interface UsageStatsCountDelegate {
  count(input: { where: { projectId: { in: string[] } } }): Promise<number>;
}

export interface UsageStatsOrganizationDatabase {
  organization: {
    findMany(input: { select: { id: true; name: true } }): Promise<UsageStatsOrganization[]>;
  };
}

export interface UsageStatsProjectDatabase {
  project: {
    findMany(input: {
      where: { team: { organizationId: string } };
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
  annotation: UsageStatsCountDelegate;
  annotationQueue: UsageStatsCountDelegate;
  annotationQueueItem: UsageStatsCountDelegate;
  annotationScore: UsageStatsCountDelegate;
  batchEvaluation: UsageStatsCountDelegate;
  customGraph: {
    count(input: { where: { projectId: { in: string[] }; kind: string } }): Promise<number>;
  };
  dataset: UsageStatsCountDelegate;
  datasetRecord: UsageStatsCountDelegate;
  experiment: UsageStatsCountDelegate;
  trigger: UsageStatsCountDelegate;
  workflow: UsageStatsCountDelegate;
}

export interface UsageStatsWorkerDatabase
  extends UsageStatsOrganizationDatabase, UsageStatsProjectDatabase {}

export interface UsageStatsReport extends Omit<UsageStatsProjectCounts, "projectIds"> {
  totalTraces: number;
  totalScenarioEvents: number;
  timestamp: string;
}

export interface UsageStatsCountInput {
  organizationId: string;
  projectIds: string[];
}

export interface UsageStatsClickHouseQuery {
  query: string;
  query_params: { projectIds: string[] };
  format: "JSONEachRow";
}

export interface UsageStatsClickHouseQueryResult {
  json(): Promise<unknown>;
}


export interface UsageStatsClickHouseClient {
  query(input: UsageStatsClickHouseQuery): Promise<UsageStatsClickHouseQueryResult>;
}

/** Resolves the ClickHouse client for the organization owning a report. */
export interface UsageStatsClickHouseClientResolver {
  tryResolve(organizationId: string): Promise<UsageStatsClickHouseClient | null>;
}

export interface UsageStatsCollector {
  collect(input: { organizationId: string }): Promise<UsageStatsReport>;
}

/** Infrastructure boundary for the self-hosted telemetry receiver. */
export interface UsageStatsTelemetryClient {
  send(report: Record<string, unknown>): Promise<void>;
}

/** Infrastructure boundary for reporting a per-organization delivery failure. */
export interface UsageStatsErrorReporter {
  capture(input: { instanceId: string; error: unknown }): Promise<void>;
}

export type QueueControlAction =
  | "queue_redrive_dlq_groups"
  | "queue_discard_dlq_groups"
  | "queue_drain_group"
  | "queue_drain_tenant"
  | "queue_move_group_to_dlq"
  | "queue_move_all_blocked_to_dlq"
  | "queue_unblock_group"
  | "queue_unblock_all";

/**
 * Audit sink for GroupQueue operator actions (specs/ops/dead-letter-recovery.feature). The Redis substrate forgets
 * DLQ entries at their TTL, so for a discard THIS row is the retained mark: the queue, the groups, how many jobs
 * they held, and their last errors survive here after the entries themselves are gone.
 */
export abstract class QueueAuditSink {
  abstract append(entry: {
    actorUserId: string;
    action: QueueControlAction;
    queueName: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
