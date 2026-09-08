/**
 * The operator back office's application: what its door calls.
 *
 * It holds every capability the feature's api file reaches — the operations
 * service and the three explorers the process composes alongside it, the
 * feature-flag registry and the project search — and it is the one typed thing
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
} from "@langwatch/audit-log-contract";
import type {
  FeatureFlagRules,
  FeatureFlagApi,
  OperatorFeatureFlagCatalogue,
} from "@langwatch/feature-flag-contract";
import { listFeatureFlags } from "@langwatch/feature-flag-contract";
import { HandledError, NotFoundError } from "@langwatch/handled-error";
import type {
  AdminIdentity,
  AggregateDiscovery,
  AggregateEventView,
  AggregateProcessManager,
  AggregateSearchResult,
  Anomaly,
  AnomalyKind,
  DashboardData,
  DeadLetterCount,
  GroupInfo,
  DeadOutboxMessageView,
  OpsService,
  OpsSnapshotService,
  OutboxAttemptView,
  ProcessAuditEntryView,
  ProcessFleetSummary,
  ProcessInstanceDetail,
  ProcessInstanceRow,
  ProcessOutboxMessageView,
  ProcessWakeRow,
  ProjectionStateAtEvent,
  ReplayHistoryEntry,
  ReplayStatus,
} from "@langwatch/ops-contract";
import type { OpsApiGetBadgeCountsOutput } from "@langwatch/ops-contract";
import { OpsApi } from "@langwatch/ops-contract";
import { AuthApi, type AuthApi as AuthApiContract } from "@langwatch/auth-contract";
import {
  ProjectApi,
  type ProjectApi as ProjectApiContract,
  type SearchProjectsResult,
} from "@langwatch/project-contract";
import { UserApi, type UserApi as UserApiContract } from "@langwatch/user-contract";
import type { OpsEventingIntrospectionPort } from "../ports/eventing-introspection.port.ts";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { withKillSwitchDescriptors } from "../rules/ops-kill-switch-catalogue.rules.ts";

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
 * composition over its event store — but typed with the contract's
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
  tryGetInstanceDetail(input: { ref: OpsProcessRef }): Promise<ProcessInstanceDetail | null>;
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
 * latter, and `unknown` is what the browser receives as `{}` — every field the
 * replay drawer, the history table and the status banner read came back
 * unchecked.
 */
export type OpsReplayRunner = {
  getHistory(): Promise<ReplayHistoryEntry[]>;
  tryFindHistoryEntry(input: { runId: string }): Promise<ReplayHistoryEntry | null>;
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

/** The operator, as far as this feature reads them. */
export type OpsOperator = Readonly<{
  id: string;
  name?: string | null;
  email?: string | null;
  /** The real admin behind an impersonation session, if there is one. */
  impersonator?: Readonly<{ email?: string | null }> | null;
}>;

/** What the process composes this feature's application from. */
export interface OpsAppDependencies {
  users: UserApiContract;
  auth: AuthApiContract;
  projects: ProjectApiContract;
  auditLog: AuditLogApiContract;
}

/** The process-owned adapters used to make one Ops capability at boot. */
export interface OpsAppInfrastructure {
  createCapability(dependencies: OpsAppDependencies): OpsCapability;
  featureFlags: FeatureFlagApi;
  /**
   * The live pipeline graph, read for the kill-switch keys an operator may
   * set. Without it every generated key is unsettable.
   */
  eventingIntrospection: OpsEventingIntrospectionPort;
}
type OpsRuntimeDependencies = Readonly<{
  ops: OpsCapability;
  featureFlags: FeatureFlagApi;
  projects: ProjectApiContract;
  eventingIntrospection: OpsEventingIntrospectionPort;
}>;
type OpsSetup = FeatureSetup<
  {
    users: typeof UserApi;
    auth: typeof AuthApi;
    projects: typeof ProjectApi;
    auditLog: typeof AuditLogApi;
  },
  OpsAppInfrastructure,
  undefined
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
 * shape, and this one stands in front of irreversible infrastructure work.
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
 * so `ops:manage` is inherited by an impersonation session — and "acting as"
 * another user is the wrong posture for irreversible infrastructure surgery,
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
 * The damage these writes do is silent — deleting a blob completes the job
 * that referenced it without its handler ever running — so the confirmation is
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
 * Reads are deliberately permissive — the operator catalogue surfaces orphan
 * rows so they can be deleted — but a write to an unregistered key would store
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

export class OpsApp implements OpsApi {
  static readonly contract = OpsApi;
  static readonly dependencies = {
    users: UserApi,
    auth: AuthApi,
    projects: ProjectApi,
    auditLog: AuditLogApi,
  };
  static readonly configSchema = void 0;

  static create(setup: OpsSetup): OpsApp {
    const { infrastructure } = setup;

    return new OpsApp({
      ops: infrastructure.createCapability(setup.dependencies),
      featureFlags: infrastructure.featureFlags,
      projects: setup.dependencies.projects,
      eventingIntrospection: infrastructure.eventingIntrospection,
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
   * `OpsService.isAdmin(identity: AdminIdentity)` is the contract, and the
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
   * damage is silent — pinning an organization back onto the legacy
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
  tryGetDashboardData(): DashboardData | null {
    return this.#dependencies.ops.snapshots?.tryGetDashboardData() ?? null;
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
    const group = await this.#dependencies.ops.tryGetQueueGroup(input);
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
   * orphan rows — keys that no longer match the registry or the pipeline graph
   * — so operators can delete them, and validating the key here would break
   * exactly that cleanup path.
   */
  clearFeatureFlag(input: { key: string; lastEditedBy: string | null }): Promise<void> {
    return this.#dependencies.featureFlags.clearStoredFlag(input);
  }

  discoverAggregates(input: Parameters<OpsEventExplorer["discoverAggregates"]>[0]) {
    return this.#dependencies.ops.eventExplorer.discoverAggregates(input);
  }

  searchAggregates(input: Parameters<OpsEventExplorer["searchAggregates"]>[0]) {
    return this.#dependencies.ops.eventExplorer.searchAggregates(input);
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
  tryGetInstanceDetail(input: Parameters<OpsProcessExplorer["tryGetInstanceDetail"]>[0]) {
    return this.#dependencies.ops.managerExplorer.tryGetInstanceDetail(input);
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
  tryFindHistoryEntry(input: Parameters<OpsReplayRunner["tryFindHistoryEntry"]>[0]) {
    return this.#dependencies.ops.replay.tryFindHistoryEntry(input);
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
  tryGetBlob(input: Parameters<OpsService["tryGetBlob"]>[0]) {
    return this.#dependencies.ops.tryGetBlob(input);
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
  tryGetQueueGroup(input: Parameters<OpsService["tryGetQueueGroup"]>[0]) {
    return this.#dependencies.ops.tryGetQueueGroup(input);
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
