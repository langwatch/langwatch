// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GovernanceOcsfExportRow } from "@langwatch/enterprise-governance-contract";
import type { ProcessStore } from "@langwatch/eventing";
import type { Instant } from "@langwatch/time";

import type { ActivityMonitorRepository } from "./activity-monitor.repository.ts";
import type { AgentRegistrySettingsRepository } from "./agent-registry-settings.repository.ts";
import type { AgentRegistryRepository } from "./agent-registry.repository.ts";
import type { AgentStopClaimRepository } from "./agent-stop-claim.repository.ts";
import type { AgentStopPlanRepository } from "./agent-stop-plan.repository.ts";
import type { AgentStopTargetPriorStateRepository } from "./agent-stop-target-prior-state.repository.ts";
import type { AgentStopRepository } from "./agent-stop.repository.ts";
import type { AggregateReconcileLockRepository } from "./aggregate-reconcile-lock.repository.ts";
import type { AiToolCatalogRepository } from "./ai-tool-catalog.repository.ts";
import type { AnomalyRuleRepository } from "./anomaly-rule.repository.ts";
import type {
  OcsfEventBatchWriter,
  OcsfIngestOrderedReader,
  OcsfSeatReportReader,
} from "./clickhouse/clickhouse.ocsf-events.repository.ts";
import type { CostAttributionPolicyRepository } from "./cost-attribution-policy.repository.ts";
import type { DepartmentRepository } from "./department.repository.ts";
import type { DiscoveredAgentRepository } from "./discovered-agent.repository.ts";
import type { DiscoveredPersonRepository } from "./discovered-person.repository.ts";
import type { ErasedIdentifierSuppressionRepository } from "./erased-identifier-suppression.repository.ts";
import type { GovernanceAwsConnectionRepository } from "./governance-aws-connection.repository.ts";
import type { GovernanceCostChargeRepository } from "./governance-cost-charge.repository.ts";
import type { GovernanceCostRollupRepository } from "./governance-cost-rollup.repository.ts";
import type { GovernanceRateLimitRepository } from "./governance-rate-limit.repository.ts";
import type { GovernanceSetupStateRepository } from "./governance-setup-state.repository.ts";
import type { GovernanceTenantHistoryRepository } from "./governance-tenant-history.repository.ts";
import type { IdentityMatchSuggestionRepository } from "./identity-match-suggestion.repository.ts";
import type { IdentityMatchRepository } from "./identity-match.repository.ts";
import type { IngestionPullLifecycleRepository } from "./ingestion-pull-lifecycle.repository.ts";
import type { IngestionPullRunRepository } from "./ingestion-pull-run.repository.ts";
import type { IngestionSourceRepository } from "./ingestion-source.repository.ts";
import type { IngestionTemplateRepository } from "./ingestion-template.repository.ts";
import type { KillSwitchLockRepository } from "./kill-switch-lock.repository.ts";
import type { OrganizationSupportContactRepository } from "./organization-support-contact.repository.ts";
import type { RollupErasureRepository } from "./rollup-erasure.repository.ts";
import type { SecurityLakeCallerRepository } from "./security-lake-caller.repository.ts";
import type { SpendSpikeAnomalyRepository } from "./spend-spike-anomaly.repository.ts";
import type { SuppressionSnapshotRepository } from "./suppression-snapshot.repository.ts";

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

export interface GovernanceKpiContributionWriter {
  /** Upsert/replacing identity is (tenant, source, hour, trace). */
  insertContribution(row: GovernanceKpiContribution): Promise<void>;
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

export type { OcsfIngestOrderedReader };

export interface GovernanceOcsfEventsReader {
  findAll(input: {
    tenantId: string;
    sinceMs: number;
    sinceEventId: string;
    limit: number;
  }): Promise<GovernanceOcsfExportRow[]>;
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

/**
 * Where a pull run's audit rows go: a whole page at once. There is no per-row
 * insert here on purpose; each INSERT waits for its async flush, so a page
 * written one row at a time is a page of round trips.
 */
export interface GovernanceOcsfEventSink {
  insertEvents(rows: GovernanceOcsfEvent[]): Promise<void>;
}

export type GovernanceOcsfEvent = {
  tenantId: string;
  eventId: string;
  /** OCSF class of an event pushed in from another source; LangWatch's own rows are 6003. */
  classUid?: number;
  categoryUid?: number;
  typeUid?: number;
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

export interface GovernanceOcsfEventWriter {
  /** Upsert/replacing identity is (tenant, eventId). */
  insertEvent(row: GovernanceOcsfEvent): Promise<void>;
}

/**
 * The rows the governance module owns, chosen once at boot.
 *
 * The rest of the ingestion-pull half of the module (sources, activity
 * rollups and the pull-run projection) reads and writes
 * through its own narrow seams and is not yet part of the selection; those
 * rows are listed as unfinished in the conversion report rather than declared
 * here with no memory twin behind them. `ingestionTemplates` is the one row
 * of that half already converted — both tiers exist, so the REST family's
 * seven template operations no longer need the ~100-operation facade.
 */
export interface GovernanceRepositories {
  readonly activityMonitor: ActivityMonitorRepository;
  readonly agentRegistry: AgentRegistryRepository;
  readonly agentRegistrySettings: AgentRegistrySettingsRepository;
  /** The kill switch: plans, claims, target prior states, AWS connections, the AgentStop projection. */
  readonly agentStopPlans: AgentStopPlanRepository;
  readonly agentStopClaims: AgentStopClaimRepository;
  readonly agentStopTargetPriorStates: AgentStopTargetPriorStateRepository;
  readonly agentStops: AgentStopRepository;
  readonly awsConnections: GovernanceAwsConnectionRepository;
  readonly aggregateReconcileLock: AggregateReconcileLockRepository;
  readonly killSwitchLock: KillSwitchLockRepository;
  readonly aiTools: AiToolCatalogRepository;
  readonly anomalyRules: AnomalyRuleRepository;
  readonly costAttributionPolicies: CostAttributionPolicyRepository;
  readonly departments: DepartmentRepository;
  readonly discoveredAgents: DiscoveredAgentRepository;
  readonly discoveredPeople: DiscoveredPersonRepository;
  readonly erasedIdentifierSuppressions: ErasedIdentifierSuppressionRepository;
  readonly identityMatches: IdentityMatchRepository;
  readonly identityMatchSuggestions: IdentityMatchSuggestionRepository;
  readonly ingestionPullLifecycle: IngestionPullLifecycleRepository;
  readonly ingestionPullRuns: IngestionPullRunRepository;
  readonly ingestionSources: IngestionSourceRepository;
  readonly ingestionTemplates: IngestionTemplateRepository;
  readonly costRollup: GovernanceCostRollupRepository;
  /** The per-charge record the drift check holds the rollup against. */
  readonly costCharges: GovernanceCostChargeRepository;
  readonly ocsfEvents: GovernanceClickHouseRepositories["ocsfEvents"];
  /** Where a process without a pipeline queues OCSF pushes; the memory tier has none. */
  readonly ocsfPushIntents?: Pick<ProcessStore, "appendIntents">;
  /** The push receivers' per-caller throttle. */
  readonly rateLimits: GovernanceRateLimitRepository;
  /** The `governance_kpis` rows the spend-spike evaluator reads and the trace pull writes. */
  readonly anomalySpend: GovernanceClickHouseRepositories["anomalySpend"];
  readonly rollupErasure: RollupErasureRepository;
  readonly setupState: GovernanceSetupStateRepository;
  readonly spendSpikeAnomalies: SpendSpikeAnomalyRepository;
  readonly supportContacts: OrganizationSupportContactRepository;
  readonly suppressionSnapshot: SuppressionSnapshotRepository;
  readonly tenantHistory: GovernanceTenantHistoryRepository;
}

/**
 * The ClickHouse-backed rows the governance module owns: a second tier beside
 * {@link GovernanceRepositories} because it lives behind the `clickhouse` member.
 */
export interface GovernanceClickHouseRepositories {
  readonly anomalySpend: AnomalySpendReader & GovernanceKpiContributionWriter;
  readonly ocsfEvents: GovernanceOcsfEventsReader &
    GovernanceOcsfEventWriter &
    OcsfEventBatchWriter &
    OcsfSeatReportReader &
    OcsfIngestOrderedReader &
    SecurityLakeCallerRepository;
}

/**
 * How every ClickHouse repository reaches a client: by tenant, resolved at
 * call time rather than bound once at construction. The live tier's factory
 * hands every repository the same resolver, closed over the one
 * `clickhouse` process member — there is one client, not one per tenant, so
 * the resolver ignores the id it is given. The signature stays per-tenant
 * because every query below was written against it, same convention as
 * `modules/trace/process`'s `TraceClickHouseWriteResolver`.
 */
/**
 * The client a ClickHouse-tier governance repository is handed, narrowed to the
 * two methods every one of them calls. Narrow rather than the vendor client so a
 * member-backed wrapper satisfies it without a cast.
 */
interface GovernanceClickHouseTenantClient {
  query<Row>(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number>;
  }): Promise<{ json(): Promise<Row[]> }>;
  insert(input: {
    table: string;
    values: readonly Record<string, unknown>[];
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, number>;
  }): Promise<unknown>;
}

export type GovernanceClickHouseTenantResolver = (
  tenantId: string,
) => Promise<GovernanceClickHouseTenantClient>;

/**
 * The OCSF schema version stamped on every governance_ocsf_events row (migration 00028).
 * SIEM consumers filter on it; bump it with the RawOcsfJson shape.
 */
export const OCSF_STORED_SCHEMA_VERSION = "1.1.0";
export const OCSF_API_ACTIVITY_CLASS_UID = 6003;
export const OCSF_APPLICATION_ACTIVITY_CATEGORY_UID = 6;

/** A stored event as the export reads it; LangWatch's own rows default to API Activity. */
export function governanceOcsfExportRowOf(row: GovernanceOcsfEvent): GovernanceOcsfExportRow {
  const classUid = row.classUid ?? OCSF_API_ACTIVITY_CLASS_UID;
  return {
    eventId: row.eventId,
    ocsfSchemaVersion: OCSF_STORED_SCHEMA_VERSION,
    traceId: row.traceId,
    sourceId: row.sourceId,
    sourceType: row.sourceType,
    classUid,
    categoryUid: row.categoryUid ?? OCSF_APPLICATION_ACTIVITY_CATEGORY_UID,
    activityId: row.activityId,
    typeUid: row.typeUid ?? classUid * 100 + row.activityId,
    severityId: row.severityId,
    eventTimeMs: row.eventTime.epochMilliseconds,
    actorUserId: row.actorUserId,
    actorEmail: row.actorEmail,
    actorEnduserId: row.actorEnduserId,
    actionName: row.actionName,
    targetName: row.targetName,
    anomalyAlertId: row.anomalyAlertId,
    rawOcsfJson: row.rawOcsfJson,
  };
}
