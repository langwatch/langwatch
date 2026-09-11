import type { ApiKeyRevocationCause } from "@langwatch/api-key-contract";
import type { ActivityEventDetailRow, ActivityMonitorPagedWindowQuery, ActivityMonitorSummary, ActivityMonitorWindowQuery, ConfigureIngestionPullCommand, DisableIngestionPullCommand, GovernanceIngestionSource, GovernanceOcsfExportRow, IngestionSourceHealthRow, PersonalUsageBreakdown, PersonalUsageBucket, PersonalUsageWindow, PersonalVirtualKey, PulledUsageObservedEventData, RecentAnomalyRow, RecordIngestionPullRunCompletedCommand, RecordIngestionPullRunFailedCommand, RecordPulledUsageCommand, RecordWorkspaceViewInput, SourceHealthMetrics, SpendByDepartmentRow, SpendByTeamRow, SpendByUserRow, SpendOverTimeGroupBy, SpendOverTimeResult } from "@langwatch/enterprise-governance-contract";
import type { Event, IntentContext, ProcessStore, TriggerContext } from "@langwatch/eventing";
import type { Instant } from "@langwatch/time";
import type { exportTraceServiceRequestSchema } from "@langwatch/trace-contract";
import type { z } from "zod";
export interface GovernanceInfrastructure {  activityMonitorRepository: ActivityMonitorRepository;
  adminWorkspaceViewOcsf: AdminWorkspaceViewOcsfChannel;
  anomalyAlertHttp: AnomalyAlertHttpClient;
  anomalySpendReader: AnomalySpendReader;
  cliAdminContact: CliAdminContactReader;
  cliBudgetOverview: CliBudgetOverviewReader;
  cliTokenStore: CliTokenStore;
  gatewayDebit: GatewayBudgetLedger;
  governanceClickHouseClient: GovernanceClickHouseClient;
  governanceClickHouseResolver: GovernanceClickHouseResolver;
  governanceEncryption: GovernanceEncryptor;
  governanceEventing: GovernanceEventingChannel;
  governanceHttp: GovernanceHttpClient;
  governanceKpiContribution: GovernanceKpiContributionWriter;
  governanceObjectStorage: GovernanceObjectStore;
  governanceOcsfEvent: GovernanceOcsfEventWriter;
  governanceOcsfEventsReader: GovernanceOcsfEventsReader;
  governanceProject: GovernanceProjectDirectory;
  governanceSetupActivity: GovernanceSetupActivityReader;
  governanceSignal: GovernanceSignalChannel;
  governanceSubscriberDiagnostics: GovernanceSubscriberDiagnosticsSink;
  governanceWebhook: GovernanceWebhookChannel;
  ingestionKeyCapability: IngestionKeyCapability;
  ingestionKeyIssuer: IngestionKeyIssuer;
  ingestionKeyRepository: IngestionKeyRepository;
  personalUsageReader: PersonalUsageReader;
  personalVirtualKeyIssuer: PersonalVirtualKeyIssuer;
  pulledUsageLedger: PulledUsageLedgerRepository;
  pulledUsageRate: PulledUsageRateReader;
  quarantineTenant: QuarantineTenantResolver;
  quarantineTraceActivity: QuarantineTraceActivityReader;
  traceAlertMetrics: TraceAlertMetricsSink;
  traceAlertOriginGuard: TraceAlertOriginGuard;
  traceAlertTrigger: TraceAlertTriggerReader;
  traceAlertTriggerMatch: TraceAlertTriggerMatchChannel;
}

export type AnomalyAlertHttpResponse = {
  status: number;
  ok: boolean;
  statusText: string;
};


export interface AnomalyAlertHttpClient {
  post(input: {
    url: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }): Promise<AnomalyAlertHttpResponse>;
}

export type CliBudgetOverview = {
  gatewayAccess: boolean;
  budgets: Array<{
    window: string;
    limitUsd: string;
    spentUsd: string;
  }>;
};


export interface CliBudgetOverviewReader {
  overviewForUser(input: {
    userId: string;
    organizationId: string;
  }): Promise<CliBudgetOverview>;
}


export interface CliAdminContactReader {
  tryResolveAdminEmail(organizationId: string): Promise<string | null>;
}


export interface CliTokenStore {
  members(key: string): Promise<string[]>;
  tryGet(key: string): Promise<string | null>;
  delete(key: string): Promise<number>;
  removeMembers(key: string, members: string[]): Promise<number>;
}

export type GatewaySpendUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cache_creation_1h_tokens: number;
  reasoning_tokens: number;
  input_audio_tokens: number;
  output_audio_tokens: number;
  input_chars: number;
  audio_ms: number;
  input_image_tokens: number;
  output_image_tokens: number;
  image_count: number;
};

export type GatewaySpendAttribution = {
  organization_id: string;
  team_id: string;
  virtual_key_id: string;
  principal_user_id: string;
  end_user_id: string;
};

export type GatewaySpendAdmittedData = GatewaySpendAttribution & {
  gateway_request_id: string;
  outcome_carries_attribution: boolean;
};

export type GatewaySpendOutcomeData = GatewaySpendAttribution & {
  gateway_request_id: string;
  model: string;
  model_provider_id: string;
  usage: GatewaySpendUsage | null;
  cost_nano_usd: number;
  rate_version: string;
  duration_ms: number;
  occurred_at: number;
};

export type GatewaySpendFailedData = GatewaySpendOutcomeData & {
  error: { type: string; http_status: number };
};

export type GatewaySpendSettledData = GatewaySpendAttribution & {
  gateway_request_id: string;
  occurred_at: number;
  reason: string;
  model: string;
  model_provider_id: string;
};

export const GATEWAY_SPEND_ADMITTED_EVENT_TYPE = "lw.gateway.spend.admitted" as const;
export const GATEWAY_SPEND_CONFIRMED_EVENT_TYPE = "lw.gateway.spend.confirmed" as const;
export const GATEWAY_SPEND_FAILED_EVENT_TYPE = "lw.gateway.spend.failed" as const;
export const GATEWAY_SPEND_SETTLED_EVENT_TYPE = "lw.gateway.spend.settled" as const;

export type GatewaySpendProcessingEvent =
  | (Event<GatewaySpendAdmittedData> & {
      type: typeof GATEWAY_SPEND_ADMITTED_EVENT_TYPE;
    })
  | (Event<GatewaySpendOutcomeData> & {
      type: typeof GATEWAY_SPEND_CONFIRMED_EVENT_TYPE;
    })
  | (Event<GatewaySpendFailedData> & {
      type: typeof GATEWAY_SPEND_FAILED_EVENT_TYPE;
    })
  | (Event<GatewaySpendSettledData> & {
      type: typeof GATEWAY_SPEND_SETTLED_EVENT_TYPE;
    });

export type GatewayBudgetScope =
  | "ORGANIZATION"
  | "TEAM"
  | "PROJECT"
  | "VIRTUAL_KEY"
  | "PRINCIPAL"
  | "GROUP"
  | "ATTRIBUTED_USER";

export type GatewayBudgetWindow = "MINUTE" | "HOUR" | "DAY" | "WEEK" | "MONTH" | "TOTAL" | "MANUAL";

export type GatewayBudgetDefinition = {
  id: string;
  scopeType: GatewayBudgetScope;
  window: GatewayBudgetWindow;
  onBreach: "BLOCK" | "WARN";
};

export type GatewayResolvedBudget = {
  budget: GatewayBudgetDefinition;
  bucketScopeId: string;
  endUserId: string | null;
};

export type GatewayBudgetDebitRow = {
  tenantId: string;
  budgetId: string;
  scope: GatewayBudgetScope;
  scopeId: string;
  window: GatewayBudgetWindow;
  virtualKeyId: string;
  providerKey: string | null;
  gatewayRequestId: string;
  amountNanoUsd: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  model: string;
  durationMs: number;
  status: "SUCCESS" | "BLOCKED_BY_GUARDRAIL" | "PROVIDER_ERROR";
  occurredAt: Instant;
};

export type GatewayBudgetCrossingCandidate = {
  tenantId: string;
  budgetId: string;
  bucketScopeId: string;
  endUserId: string | null;
};


export interface GatewayBudgetLedger {
  resolve(input: {
    target: {
      organizationId: string;
      teamId: string | null;
      projectId: string;
      virtualKeyId: string;
      principalUserId: string | null;
      endUserId: string | null;
    };
    providerKey: string | null;
  }): Promise<GatewayResolvedBudget[]>;

  insert(rows: GatewayBudgetDebitRow[]): Promise<void>;

  detectCrossings(rows: GatewayBudgetCrossingCandidate[]): Promise<void>;

  shouldEmitBudgetUpdated(input: { projectId: string }): Promise<boolean>;

  emitBudgetUpdated(input: {
    organizationId: string;
    projectId: string;
    gatewayRequestId: string;
    virtualKeyId: string;
    budgetIds: string[];
  }): Promise<void>;
}

/**
 * Folded together from the now-split ocsf-export.port.ts,
 * admin-workspace-view-audit.port.ts and governance-setup-state.port.ts: each
 * remainder, once its repository interface moved to repositories/audit/, fell
 * under the twenty-line fragment-file floor on its own. All three are small
 * read-side signal ports the installation adapter takes as optional
 * members, so they sit together here rather than as three stubs.
 */
export interface GovernanceOcsfEventsReader {
  findAll(input: {
    tenantId: string;
    sinceMs: number;
    sinceEventId: string;
    limit: number;
  }): Promise<GovernanceOcsfExportRow[]>;
}


export interface AdminWorkspaceViewOcsfChannel {
  mirror(input: {
    tenantId: string;
    auditLogId: string;
    createdAtMs: number;
    view: RecordWorkspaceViewInput;
    label: string;
  }): Promise<void>;
}


export interface GovernanceSetupActivityReader {
  hasRecentActivity(input: { tenantId: string; sinceMs: number }): Promise<boolean>;
}

export interface GovernanceDiagnosticsSink {
  warn(message: string, context: Record<string, unknown>): void;
}


export interface GovernanceEncryptor {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

/** Commands owned by the eventing process, not by the Governance domain. */
export interface GovernanceEventingChannel {
  configureIngestion(input: ConfigureIngestionPullCommand): Promise<void>;
  disableIngestion(input: DisableIngestionPullCommand): Promise<void>;
  recordIngestionRunCompleted(
    input: RecordIngestionPullRunCompletedCommand,
  ): Promise<void>;
  recordIngestionRunFailed(input: RecordIngestionPullRunFailedCommand): Promise<void>;
  recordPulledUsage(input: RecordPulledUsageCommand): Promise<void>;
}

/** One scheduled pull run, as the worker composition root hands it in. */
export type IngestionPullRun = {
  sourceId: string;
  runId: string;
  scheduledFor: number;
  cursor: string | null;
};

export interface IngestionPullRunner {
  run(input: {
    sourceId: string;
    cursor: string | null;
  }): Promise<{ nextCursor: string | null; eventCount: number }>;
}

export interface IngestionPullOutcomeChannel {
  completed(input: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    runId: string;
    scheduledFor: number;
    nextCursor: string | null;
    eventCount: number;
  }): Promise<void>;

  failed(input: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    runId: string;
    scheduledFor: number;
    error: string;
    errorCode: string;
    retryable: false;
  }): Promise<void>;
}

export interface IngestionPullMetricsSink {
  count(outcome: "completed" | "failed_retryable" | "failed_final"): void;
  observeDuration(durationMs: number): void;
}

/** UTC schedule calculation supplied by the worker composition root. */
export interface IngestionPullScheduler {
  nextRunAt(input: { cron: string; after: number }): number;
}

export interface IngestionPullTenantResolver {
  resolveTenantId(organizationId: string): Promise<string>;
}

export type GovernanceTraceRequest = z.input<typeof exportTraceServiceRequestSchema>;

export interface GovernanceTraceIngestionClient {
  ingest(input: { projectId: string; request: GovernanceTraceRequest }): Promise<{
    rejectedSpans: number;
    ingestionFailures: number;
    ingestionFailureMessage?: string;
  }>;
}

export type GovernanceOcsfEventInput = {
  tenantId: string;
  eventId: string;
  traceId: string;
  sourceId: string;
  sourceType: string;
  activityId: 1 | 2 | 3 | 4 | 6;
  severityId: 1 | 3 | 4 | 5 | 6;
  eventTime: Instant;
  actorUserId: string;
  actorEmail: string;
  actorEnduserId: string;
  actionName: string;
  targetName: string;
  anomalyAlertId: string;
  rawOcsfJson: string;
};

export interface IngestionPullSourceReader {
  findById(id: string): Promise<GovernanceIngestionSource | null>;
}

export interface GovernanceOcsfEventSink {
  insertEvent(input: GovernanceOcsfEventInput): Promise<void>;
}

export interface PulledUsageDispatcher {
  recordPulledUsage(
    input: PulledUsageObservedEventData & {
      tenantId: string;
      occurredAt: number;
    },
  ): Promise<void>;
}

export interface PulledUsageEntitlements {
  isEnabled(organizationId: string): Promise<boolean>;
}

export interface IngestionPullDiagnosticsSink {
  info(message: string, context: Record<string, unknown>): void;
  warn(message: string, context: Record<string, unknown>): void;
  error(message: string, context: Record<string, unknown>): void;
  capture(error: Error, context: Record<string, unknown>): void;
}

export interface IngestionSourceEntitlements {
  hasEnterprisePlan(organizationId: string): Promise<boolean>;
}

export interface IngestionSourceLifecycleChannel {
  sync(source: GovernanceIngestionSource): Promise<void>;
}

export interface IngestionPullLifecycleChannel {
  configure(input: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    cron: string;
    configVersion: string;
    cursor: string | null;
  }): Promise<void>;

  disable(input: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    configVersion: string;
  }): Promise<void>;
}

export type GovernanceHttpResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
};


export interface GovernanceHttpClient {
  fetch(
    url: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
      /** Forwarded to the SSRF-safe process adapter for secret-bearing calls. */
      followRedirects?: boolean;
    },
  ): Promise<GovernanceHttpResponse>;
}

export type GovernanceObjectStorageCredentials = {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
};


export interface GovernanceObjectStore {
  list(input: {
    bucket: string;
    prefix: string;
    region: string;
    endpoint?: string;
    startAfter?: string;
    credentials: GovernanceObjectStorageCredentials;
    signal?: AbortSignal;
    limit: number;
  }): Promise<string[]>;

  readText(input: {
    bucket: string;
    key: string;
    region: string;
    endpoint?: string;
    credentials: GovernanceObjectStorageCredentials;
    signal?: AbortSignal;
    maxBytes: number;
  }): Promise<string>;
}

/**
 * The two project reads Governance makes: the tenant a pull writes under, and
 * the hidden per-organization project every receiver ensures.
 *
 * Stated here in contract types rather than taken off the project feature's
 * server package, so composing it stays the process's job. The project
 * capability satisfies it as it stands.
 */
export interface GovernanceProjectDirectory {
  tryGetWithTeam(id: string): Promise<ProjectWithTeam | null>;

  ensureInternal(input: InternalProjectQuery): Promise<InternalProject>;
}

export type GovernanceVirtualKeyLifecycleSignal = {
  virtualKey: {
    id: string;
    organizationId: string;
    name: string;
    displayPrefix: string;
    traceProjectId: string | null;
  };
  action: GovernanceVkLifecycleData["action"];
  reason?: string | null;
};

export type GovernanceResolvedBudgetCrossing = {
  candidate: GatewayBudgetCrossingCandidate;
  budget: {
    id: string;
    organizationId: string;
    scopeType: GatewayBudgetScope;
    scopeId: string;
    window: GatewayBudgetWindow;
    limitUsd: string;
    onBreach: "BLOCK" | "WARN";
  };
  spentUsd: string;
  periodStartedAtMs: number;
};


export interface GovernanceSignalChannel {
  available(): boolean;
  now(): Instant;
  tryResolveLifecycleTenant(input: {
    organizationId: string;
    preferredProjectId: string | null;
  }): Promise<string | null>;
  resolveBudgetCrossings(
    candidates: GatewayBudgetCrossingCandidate[],
    now: Instant,
  ): Promise<GovernanceResolvedBudgetCrossing[]>;
  appendVirtualKeyLifecycle(data: GovernanceVkLifecycleData): Promise<void>;
  appendBudgetCrossing(data: GovernanceBudgetCrossingData): Promise<void>;
}

export type GovernanceTraceSummary = {
  traceId: string;
  occurredAt: number;
  totalCost: number | null;
  totalPromptTokenCount: number | null;
  totalCompletionTokenCount: number | null;
  models: string[];
  attributes: Record<string, string>;
};

/**
 * The event these subscribers actually receive. They mount on the trace
 * pipeline and nowhere else, so `Event<unknown>` understated it: the origin
 * guard discriminates on `type`, and against `unknown` every such check
 * silently compiled while the guard could never narrow. This package already
 * depends on `@langwatch/trace-contract`, so naming the real union costs
 * nothing and is what lets the guard type-check at its call site.
 */
export type GovernanceTraceEvent = TraceProcessingEvent;

export type GovernanceTraceContext = TriggerContext<GovernanceTraceSummary>;

export type GovernanceKpiContribution = {
  tenantId: string;
  sourceId: string;
  sourceType: string;
  hourBucket: Instant;
  traceId: string;
  spendUsd: number;
  promptTokens: number;
  completionTokens: number;
  lastEventOccurredAt: Instant;
};

export type GovernanceOcsfEvent = {
  tenantId: string;
  eventId: string;
  traceId: string;
  sourceId: string;
  sourceType: string;
  activityId: number;
  severityId: number;
  eventTime: Instant;
  actorUserId: string;
  actorEmail: string;
  actorEnduserId: string;
  actionName: string;
  targetName: string;
  anomalyAlertId: string;
  rawOcsfJson: string;
};


export interface GovernanceKpiContributionWriter {
  /** Upsert/replacing identity is (tenant, source, hour, trace). */
  insertContribution(row: GovernanceKpiContribution): Promise<void>;
}


export interface GovernanceOcsfEventWriter {
  /** Upsert/replacing identity is (tenant, eventId). */
  insertEvent(row: GovernanceOcsfEvent): Promise<void>;
}


export interface GovernanceSubscriberDiagnosticsSink {
  warn(input: { code: string; tenantId: string; traceId: string }): void;
  capture(error: unknown): void;
}

export type TraceAlertTrigger = {
  id: string;
  action: string;
  actionClass: "notify" | "persist";
  traceDebounceMs: number;
  notificationCadence: string | null;
  hasEvaluationFilters: boolean;
};


export interface TraceAlertTriggerReader {
  activeForProject(projectId: string): Promise<TraceAlertTrigger[]>;
}


export interface TraceAlertTriggerMatchChannel {
  send(input: {
    tenantId: string;
    occurredAt: number;
    triggerId: string;
    traceId: string;
    action: string;
    actionClass: "notify" | "persist";
    traceDebounceMs: number;
    notificationCadence: string | null;
  }): Promise<void>;
}


export interface TraceAlertOriginGuard {
  passes(input: { event: GovernanceTraceEvent; state: GovernanceTraceSummary }): boolean;
}


export interface TraceAlertMetricsSink {
  countRecorded(count: number): void;
}

export type GovernanceVkLifecycleData = RecordVkLifecycleCommandData;

export type GovernanceBudgetCrossingData = RecordBudgetCrossingCommandData;

export type GovernanceEventsProcessingEvent =
  | (Event<GovernanceVkLifecycleData> & {
      type: typeof GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE;
    })
  | (Event<GovernanceBudgetCrossingData> & {
      type: typeof GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE;
    });

export type GovernanceWebhookEnvelope = {
  id: string;
  type: string;
  created: string;
  schema_version: "1";
  data: Record<string, string | null>;
};

export type GovernanceWebhookSendBatch = {
  organizationId: string;
  endpointId: string;
  batchId: string;
  envelopes: GovernanceWebhookEnvelope[];
};


export interface GovernanceWebhookChannel {
  readonly processStore: ProcessStore;
  readonly maxAttempts: number;

  webhooksEnabled(organizationId: string): Promise<boolean>;
  activeEndpointIds(input: {
    organizationId: string;
    eventType: string;
  }): Promise<string[]>;
  sendBatch(payload: GovernanceWebhookSendBatch, context: IntentContext): Promise<void>;
  retryDelayMs(input: { attempt: number }): number;
  now(): number;
}


export interface ActivityMonitorRepository {
  summary(input: ActivityMonitorWindowQuery): Promise<ActivityMonitorSummary>;
  spendByUser(input: ActivityMonitorPagedWindowQuery): Promise<SpendByUserRow[]>;
  spendByTeam(input: ActivityMonitorPagedWindowQuery): Promise<SpendByTeamRow[]>;
  spendByDepartment(input: ActivityMonitorWindowQuery): Promise<SpendByDepartmentRow[]>;
  spendOverTime(input: {
    organizationId: string;
    windowDays: number;
    groupBy: SpendOverTimeGroupBy;
  }): Promise<SpendOverTimeResult>;
  recentAnomalies(input: {
    organizationId: string;
    limit?: number;
  }): Promise<RecentAnomalyRow[]>;
  ingestionSourcesHealth(input: {
    organizationId: string;
  }): Promise<IngestionSourceHealthRow[]>;
  eventsForSource(input: {
    organizationId: string;
    sourceId: string;
    limit?: number;
    beforeIso?: string;
  }): Promise<ActivityEventDetailRow[]>;
  sourceHealthMetrics(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<SourceHealthMetrics>;
}

export type GovernanceClickHouseResult = {
  json(): Promise<unknown>;
};


export interface GovernanceClickHouseClient {
  query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
  }): Promise<GovernanceClickHouseResult>;
}


export interface GovernanceClickHouseResolver {
  tryResolve(organizationId: string): Promise<GovernanceClickHouseClient | null>;
}

export type StoredIngestionKey = {
  id: string;
  lookupId: string;
  ingestSourceType: string | null;
  ingestionTemplateId: string | null;
  /** When the key last authenticated; nothing when it never has. */
  lastUsedAt?: Instant | null;
  createdAt?: Instant;
};

/** One key as `tryDescribePersonalKey` reads it, ownership included. */
export type StoredIngestionKeyOwnership = StoredIngestionKey & {
  organizationId: string;
  userId: string | null;
  revokedAt: Instant | null;
  revocationCause: string | null;
};


export interface IngestionKeyRepository {
  tryFindIngestKey(input: {
    organizationId: string;
    projectId: string;
    sourceType: string;
  }): Promise<StoredIngestionKey | null>;

  findIngestKeysForProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<StoredIngestionKey[]>;

  /** One key by the lookup id embedded in its token, whether live or not. */
  tryFindByLookupId(input: {
    lookupId: string;
  }): Promise<StoredIngestionKeyOwnership | null>;
}


export interface IngestionKeyIssuer {
  create(input: {
    name: string;
    userId: string | null;
    createdByUserId: string;
    organizationId: string;
    permissionMode: "restricted";
    permissions: readonly ["traces:create"];
    bindings: readonly [{ role: "CUSTOM"; scopeType: "PROJECT"; scopeId: string }];
    ingestSourceType: string;
    ingestionTemplateId: string | null;
    createdByDeviceLabel: string | null;
  }): Promise<{ token: string; apiKey: { id: string } }>;

  revoke(input: {
    id: string;
    callerUserId: string;
    callerIsAdmin: boolean;
    organizationId: string;
    awaitProjection: false;
    /** Why the key dies, so the CLI can tell a re-mintable key from a dead one. */
    cause?: ApiKeyRevocationCause;
  }): Promise<void>;
}


export interface IngestionKeyCapability {
  ensureForProject(input: IngestionKeyMintCommand): Promise<IssuedIngestionKey>;
}

/**
 * Folded in from the now-deleted personal-virtual-key.port.ts: the two files
 * both concern the personal-key/personal-usage domain, and the issuer port
 * alone was under the twenty-line fragment-file floor once its repository
 * sibling moved to repositories/directory/.
 */
export interface PersonalVirtualKeyIssuer {
  issue(input: {
    organizationId: string;
    userId: string;
    personalProjectId: string;
    label: string;
    routingPolicyId: string | null;
  }): Promise<{ virtualKey: PersonalVirtualKey; secret: string }>;
  revoke(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<PersonalVirtualKey>;
}

export type PersonalUsageSummaryRow = {
  totalCost: number;
  billedCost: number;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
};

export type PersonalUsageTopModelRow = {
  model: string;
  requests: number;
};

export type IngestionPrincipalSummaryRow = {
  totalCost: number;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  topModel: { name: string; requests: number } | null;
};


export interface PersonalUsageReader {
  findSummary(input: {
    tenantId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageSummaryRow>;

  tryFindTopModel(input: {
    tenantId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageTopModelRow | null>;

  findDailyBuckets(input: {
    tenantId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageBucket[]>;

  findModelBreakdown(input: {
    tenantId: string;
    window: PersonalUsageWindow;
    limit: number;
  }): Promise<PersonalUsageBreakdown[]>;

  tryFindIngestionPrincipalSummary(input: {
    tenantId: string;
    userId: string;
    window: PersonalUsageWindow;
  }): Promise<IngestionPrincipalSummaryRow | null>;

  findIngestionPrincipalBuckets(input: {
    tenantId: string;
    userId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageBucket[]>;

  findIngestionPrincipalBreakdown(input: {
    tenantId: string;
    userId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageBreakdown[]>;
}

export type PulledUsageLedgerRow = {
  tenantId: string;
  scopeId: string;
  restatementKey: string;
  amountNanoUsd: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  model: string;
  occurredAt: Instant;
  observedAt: Instant;
};


export interface PulledUsageLedgerRepository {
  insert(rows: PulledUsageLedgerRow[]): Promise<void>;
}

export type PulledUsageRateInput = {
  model: string;
  quantities: {
    tokensInput: number;
    tokensOutput: number;
    tokensCacheRead: number;
    tokensCacheWrite: number;
  };
};


export interface PulledUsageRateReader {
  rate(input: PulledUsageRateInput): {
    costNanoUsd: number;
    rateVersion: string;
  };
}


export interface QuarantineTenantResolver {
  resolveTenantId(organizationId: string): Promise<string>;
}


export interface QuarantineTraceActivityReader {
  findSpanCountsBySource(input: {
    tenantId: string;
    sinceMs: number;
  }): Promise<Array<{ sourceId: string; spanCount: number }>>;
}

export type AnomalySpendSourceFilter =
  | { type: "all" }
  | { type: "source"; id: string }
  | { type: "source_type"; id: string };


export interface AnomalySpendReader {
  findSpendTotals(input: {
    tenantId: string;
    windowStart: Instant;
    windowEnd: Instant;
    baselineStart: Instant;
    sourceFilter: AnomalySpendSourceFilter;
  }): Promise<{ currentSpend: number; baselineSpend: number }>;
}
