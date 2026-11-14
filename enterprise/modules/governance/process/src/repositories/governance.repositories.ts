// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { GovernanceOcsfExportRow } from "@langwatch/enterprise-governance-contract";
import type { Instant } from "@langwatch/time";

import type { ActivityMonitorRepository } from "./activity-monitor.repository.ts";
import type { AggregateReconcileLockRepository } from "./aggregate-reconcile-lock.repository.ts";
import type { AiToolCatalogRepository } from "./ai-tool-catalog.repository.ts";
import type { AnomalyRuleRepository } from "./anomaly-rule.repository.ts";
import type {
  OcsfEventBatchWriter,
  OcsfSeatReportReader,
} from "./clickhouse/clickhouse.ocsf-events.repository.ts";
import type { CostAttributionPolicyRepository } from "./cost-attribution-policy.repository.ts";
import type { DepartmentRepository } from "./department.repository.ts";
import type { DiscoveredAgentRepository } from "./discovered-agent.repository.ts";
import type { DiscoveredPersonRepository } from "./discovered-person.repository.ts";
import type { ErasedIdentifierSuppressionRepository } from "./erased-identifier-suppression.repository.ts";
import type { GovernanceCostChargeRepository } from "./governance-cost-charge.repository.ts";
import type { GovernanceCostRollupRepository } from "./governance-cost-rollup.repository.ts";
import type { GovernanceRateLimitRepository } from "./governance-rate-limit.repository.ts";
import type { GovernanceSetupStateRepository } from "./governance-setup-state.repository.ts";
import type { GovernanceTenantHistoryRepository } from "./governance-tenant-history.repository.ts";
import type { IdentityMatchSuggestionRepository } from "./identity-match-suggestion.repository.ts";
import type { IdentityMatchRepository } from "./identity-match.repository.ts";
import type { IngestionPullLifecycleRepository } from "./ingestion-pull-lifecycle.repository.ts";
import type { IngestionPullRunRepository } from "./ingestion-pull-run.repository.ts";
import type { IngestionSourceEventsRepository } from "./ingestion-source-events.repository.ts";
import type { IngestionSourceRepository } from "./ingestion-source.repository.ts";
import type { IngestionTemplateRepository } from "./ingestion-template.repository.ts";
import type { OrganizationSupportContactRepository } from "./organization-support-contact.repository.ts";
import type { RollupErasureRepository } from "./rollup-erasure.repository.ts";
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

export interface GovernanceOcsfEventSink {
  insertEvent(input: GovernanceOcsfEventInput): Promise<void>;
}

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
  readonly aggregateReconcileLock: AggregateReconcileLockRepository;
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
  /** A source's pulled OCSF events and pushed log records in ClickHouse. */
  readonly ingestionSourceEvents: IngestionSourceEventsRepository;
  readonly ingestionTemplates: IngestionTemplateRepository;
  readonly costRollup: GovernanceCostRollupRepository;
  /** The per-charge record the drift check holds the rollup against. */
  readonly costCharges: GovernanceCostChargeRepository;
  readonly ocsfEvents: GovernanceClickHouseRepositories["ocsfEvents"];
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
    OcsfSeatReportReader;
}

/** The insert every ClickHouse-tier governance repository owns, in the vendor client's shape. */
interface GovernanceClickHouseInsertClient {
  insert(input: {
    table: string;
    values: readonly Record<string, unknown>[];
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, number>;
  }): Promise<unknown>;
}

/** A typed-builder repository's client: built reads, plus the inserts it owns (ADR-202). */
export type GovernanceClickHouseReadClient = Pick<ClickHouseQueryClient, "read"> &
  GovernanceClickHouseInsertClient;

/** Resolved per tenant at call time; the live tier closes over the one member and ignores the id. */
export type GovernanceClickHouseReadResolver = (
  tenantId: string,
) => Promise<GovernanceClickHouseReadClient>;
