// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GovernanceOcsfExportRow } from "@langwatch/enterprise-governance-contract";
import type { Instant } from "@langwatch/time";

import type { ActivityMonitorRepository } from "./activity-monitor.repository.ts";
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
import type { GovernanceSetupStateRepository } from "./governance-setup-state.repository.ts";
import type { GovernanceTenantHistoryRepository } from "./governance-tenant-history.repository.ts";
import type { IdentityMatchSuggestionRepository } from "./identity-match-suggestion.repository.ts";
import type { IdentityMatchRepository } from "./identity-match.repository.ts";
import type { IngestionPullLifecycleRepository } from "./ingestion-pull-lifecycle.repository.ts";
import type { IngestionPullRunRepository } from "./ingestion-pull-run.repository.ts";
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
export interface GovernanceClickHouseTenantClient {
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
