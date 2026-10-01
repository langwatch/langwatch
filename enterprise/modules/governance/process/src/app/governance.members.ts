import type { AuthzPermission } from "@langwatch/authorization";
import type {
  ActivityEventDetailRow,
  ActivityMonitorPagedWindowQuery,
  ActivityMonitorSummary,
  ActivityMonitorWindowQuery,
  ConfigureIngestionPullCommand,
  DisableIngestionPullCommand,
  GovernanceBudgetOverviewForUser,
  GovernanceIngestionSource,
  GovernanceOcsfExportRow,
  IngestionSourceHealthRow,
  PulledUsageObservedEventData,
  RecentAnomalyRow,
  RecordIngestionPullRunCompletedCommand,
  RecordIngestionPullRunFailedCommand,
  RecordPulledUsageCommand,
  SourceHealthMetrics,
  SpendByDepartmentRow,
  SpendByTeamRow,
  SpendByUserRow,
  SpendOverTimeGroupBy,
  SpendOverTimeResult,
} from "@langwatch/enterprise-governance-contract";
import type {
  InternalProject,
  InternalProjectQuery,
  ProjectWithTeam,
} from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
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
  budgets: {
    window: string;
    limitUsd: string;
    spentUsd: string;
  }[];
};

export interface CliBudgetOverviewReader {
  overviewForUser(input: { userId: string; organizationId: string }): Promise<CliBudgetOverview>;
}

/**
 * The /me budget overview: every budget binding this member's own keys in one
 * organization. Answered by `GatewayApi.budgetOverviewForUser` — the gateway
 * owns budgets, governance only presents them.
 */
export interface PersonalBudgetOverviewReader {
  overviewForUser(input: {
    userId: string;
    organizationId: string;
  }): Promise<GovernanceBudgetOverviewForUser>;
}

export interface CliAdminContactReader {
  findAdminEmail(organizationId: string): Promise<string | null>;
}

/**
 * Three small read-side signal ports (OCSF export, workspace-view audit,
 * setup state) grouped here because each alone falls under the twenty-line
 * fragment-file floor.
 */
export interface GovernanceOcsfEventsReader {
  findAll(input: {
    tenantId: string;
    sinceMs: number;
    sinceEventId: string;
    limit: number;
  }): Promise<GovernanceOcsfExportRow[]>;
}

export interface GovernanceDiagnosticsSink {
  warn(message: string, context: Record<string, unknown>): void;
}

export const silentGovernanceDiagnostics: GovernanceDiagnosticsSink = { warn: () => {} };

export interface GovernanceEncryptor {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

/** Commands owned by the eventing process, not by the Governance domain. */
export interface GovernanceEventingChannel {
  configureIngestion(input: ConfigureIngestionPullCommand): Promise<void>;
  disableIngestion(input: DisableIngestionPullCommand): Promise<void>;
  recordIngestionRunCompleted(input: RecordIngestionPullRunCompletedCommand): Promise<void>;
  recordIngestionRunFailed(input: RecordIngestionPullRunFailedCommand): Promise<void>;
  recordPulledUsage(input: RecordPulledUsageCommand): Promise<void>;
}

/** One scheduled pull run, as the worker composition root hands it in. */
export type IngestionPullRun = {
  sourceId: string;
  runId: string;
  scheduledFor: number;
  cursor: string | null;
  /** The run this one takes over from, when that run outlived its allowance. */
  abandonedRunId?: string;
};

export interface IngestionPullRunner {
  run(input: { sourceId: string; cursor: string | null }): Promise<IngestionPullRunResult>;
}

/** What one run read; the optional fields stay absent until the runner reports them. */
export type IngestionPullRunResult = {
  nextCursor: string | null;
  eventCount: number;
  errorCount?: number;
  completeness?: "complete" | "truncated";
  unreadPage?: true;
  readThroughAt?: number | null;
};

export interface IngestionPullOutcomeChannel {
  completed(input: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    runId: string;
    scheduledFor: number;
    nextCursor: string | null;
    eventCount: number;
    errorCount?: number;
    completeness?: "complete" | "truncated";
    unreadPage?: true;
    readThroughAt?: number | null;
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
    retryAfterMs?: number | null;
    replacedByRunId?: string;
  }): Promise<void>;
}

/** Where one listing's outcome lands: the ingestion-pull pipeline's own record commands. */
export type IngestionPullListingOutcome = {
  tenantId: string;
  occurredAt: number;
  sourceId: string;
  requestId: string;
  requestedAt: number;
};
export type IngestionPullListingRefusal = IngestionPullListingOutcome & {
  reason: string;
  status: number | null;
};

export interface IngestionPullListingOutcomeChannel {
  agentsListed(input: IngestionPullListingOutcome & { agentCount: number }): Promise<void>;
  agentsListingRefused(input: IngestionPullListingRefusal): Promise<void>;
  peopleListed(
    input: IngestionPullListingOutcome & {
      directoryPersonCount: number;
      withheldPersonCount: number;
    },
  ): Promise<void>;
  peopleListingRefused(input: IngestionPullListingRefusal): Promise<void>;
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

/** Main's shape: the mappers build the same OTLP request the trace door takes. */
export type GovernanceTraceRequest = IExportTraceServiceRequest;

export interface GovernanceTraceIngestionClient {
  ingest(input: { projectId: string; request: GovernanceTraceRequest }): Promise<{
    rejectedSpans: number;
    ingestionFailures: number;
    ingestionFailureMessage?: string;
  }>;
}

/**
 * OCSF v1.1 SeverityId: 1 informational, 3 low, 4 medium, 5 high, 6 critical.
 * Default 1; elevated when `langwatch.governance.anomaly_alert_id` is set.
 */
export const OCSF_SEVERITY = {
  INFO: 1,
  LOW: 3,
  MEDIUM: 4,
  HIGH: 5,
  CRITICAL: 6,
} as const;

/**
 * OCSF v1.1 ActivityId for ClassUid 6003 (API Activity): 1 create, 2 read,
 * 3 update, 4 delete, 6 invoke (an LLM call or agent action).
 */
export const OCSF_ACTIVITY = {
  CREATE: 1,
  READ: 2,
  UPDATE: 3,
  DELETE: 4,
  INVOKE: 6,
} as const;

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

/** ADR-128 §12: the discovery feed's trigger for the identity match engine. */
export interface DiscoveredPeopleMatcher {
  runFor(input: { organizationId: string }): Promise<void>;
}

export interface IngestionPullDiagnosticsSink {
  info(message: string, context: Record<string, unknown>): void;
  warn(message: string, context: Record<string, unknown>): void;
  error(message: string, context: Record<string, unknown>): void;
  capture(error: Error, context: Record<string, unknown>): void;
}

export const silentIngestionPullDiagnostics: IngestionPullDiagnosticsSink = {
  info: () => {},
  warn: () => {},
  error: () => {},
  capture: () => {},
};

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
  /**
   * Response headers, when the transport carries them. Optional because test doubles
   * build responses by hand; the 429 path doesn't use them, so absence = no Retry-After.
   */
  readonly headers?: Pick<Headers, "get">;
  /**
   * The response body stream, when the transport carries it. Optional for the same
   * reason as `headers`; callers only drain it, so absence means nothing to drain.
   */
  readonly body?: { cancel(): Promise<void> } | null;
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
    /**
     * `isTruncated` is returned rather than inferred from `keys.length`: a
     * listing that exactly hits the cap is indistinguishable from one cut
     * short by it, and inferring it would re-derive a rule that lives here.
     */
  }): Promise<{ keys: string[]; isTruncated: boolean }>;

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
 * The two project reads Governance makes: the tenant a pull writes under,
 * and the hidden per-organization project every receiver ensures. Stated
 * here rather than taken off the project feature, so composing stays the process's job.
 */
export interface GovernanceProjectDirectory {
  findWithTeam(id: string): Promise<ProjectWithTeam | null>;

  ensureInternal(input: InternalProjectQuery): Promise<InternalProject>;
}

/** The trace summary fields a governance-origin trace's KPI and OCSF rows are built from. */
export type GovernanceTraceSummary = Pick<
  TraceSummaryData,
  | "traceId"
  | "occurredAt"
  | "totalCost"
  | "totalPromptTokenCount"
  | "totalCompletionTokenCount"
  | "models"
  | "attributes"
>;

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

export interface ActivityMonitorRepository {
  sourceDataCoverage(input: {
    organizationId: string;
    sourceId: string;
    windowDays: number;
  }): Promise<{
    health: "healthy" | "unhealthy";
    consecutiveFailures: number;
    lastSuccessfulPullIso: string | null;
    days: { dayStartIso: string; covered: boolean }[];
  }>;
  summary(input: ActivityMonitorWindowQuery): Promise<ActivityMonitorSummary>;
  spendByUser(input: ActivityMonitorPagedWindowQuery): Promise<SpendByUserRow[]>;
  spendByTeam(input: ActivityMonitorPagedWindowQuery): Promise<SpendByTeamRow[]>;
  spendByDepartment(input: ActivityMonitorWindowQuery): Promise<SpendByDepartmentRow[]>;
  spendOverTime(input: {
    organizationId: string;
    windowDays: number;
    groupBy: SpendOverTimeGroupBy;
  }): Promise<SpendOverTimeResult>;
  recentAnomalies(input: { organizationId: string; limit?: number }): Promise<RecentAnomalyRow[]>;
  ingestionSourcesHealth(input: { organizationId: string }): Promise<IngestionSourceHealthRow[]>;
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
    clickhouse_settings?: Record<string, number>;
    /** One organisation's projects a `TenantId IN (...)` read binds, exactly. */
    tenantIds?: readonly string[];
  }): Promise<GovernanceClickHouseResult>;
}

export interface GovernanceClickHouseResolver {
  getClient(organizationId: string): Promise<GovernanceClickHouseClient>;
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

/**
 * What one look at one day's cost found. `reportDrift` rides on the look,
 * not a day back, since a second call would re-compare and report figures
 * this look never saw.
 */
export interface CostRollupDayLook {
  /** Cells where the summary and the events state different money. */
  mismatchedCells: number;
  /**
   * Cells whose summary row demonstrably has not folded every charge of the
   * day. Non-empty is proof the summary is catching up; empty proves nothing.
   */
  cellsBehind: number;
  /** How far the summary trails the events it is derived from. */
  lagMs: number;
  /**
   * Counts and names this look's disagreement, once and for the record. Only
   * a caller that has spent its whole retry ladder may call it; a look that
   * found no disagreement is a no-op.
   */
  reportDrift(): void;
}

/**
 * One look at one organization's day of pulled charges. It reports what it
 * saw and judges nothing — a summary the fold is seconds behind on and a
 * summary that is wrong are the same picture from one look.
 */
export interface CostRollupDayComparer {
  /**
   * The cost lane this comparer holds a day's charges against. Read by the
   * check so every comparison names its lane without repeating a literal.
   */
  readonly costSource: string;
  compareDay(params: { tenantId: string; day: string }): Promise<CostRollupDayLook>;
}

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

/** Whether the caller holds a permission on an organization, from the process's own AuthZ graph. */
export interface GovernanceMcpPermissionProbe {
  holdsOrganizationPermission(input: {
    userId: string;
    organizationId: string;
    permission: AuthzPermission;
  }): Promise<boolean>;
}
