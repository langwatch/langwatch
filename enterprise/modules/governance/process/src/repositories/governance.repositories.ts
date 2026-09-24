// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  AnomalySpendReader,
  GovernanceKpiContributionWriter,
  GovernanceOcsfEventsReader,
  GovernanceOcsfEventWriter,
  GovernanceSetupActivityReader,
  PersonalUsageReader,
  QuarantineTraceActivityReader,
} from "../app/governance.members.ts";
import type { AdminWorkspaceViewAuditRepository } from "./admin-workspace-view-audit.repository.ts";
import type { AnomalyRuleRepository } from "./anomaly-rule.repository.ts";
import type {
  OcsfEventBatchWriter,
  OcsfSeatReportReader,
} from "./clickhouse/clickhouse.ocsf-events.repository.ts";
import type { DepartmentRepository } from "./department.repository.ts";
import type { GatewaySpendRepository } from "./gateway-spend.repository.ts";
import type { GovernanceDirectoryRepository } from "./governance-directory.repository.ts";
import type {
  GovernanceOcsfExportRepository,
  GovernanceSetupStateRepository,
} from "./governance-setup-state.repository.ts";
import type { IngestionTemplateRepository } from "./ingestion-template.repository.ts";
import type { OrganizationSupportContactRepository } from "./organization-support-contact.repository.ts";
import type { PersonalVirtualKeyRepository } from "./personal-virtual-key.repository.ts";
import type { RoutingPolicyRepository } from "./routing-policy.repository.ts";
import type { OrganizationSessionPolicyRepository } from "./session-policy.repository.ts";
import type { SpendSpikeAnomalyRepository } from "./spend-spike-anomaly.repository.ts";

/**
 * The rows the governance module owns, chosen once at boot.
 *
 * The rest of the ingestion-pull half of the module (sources, activity
 * rollups, the pull-run projection and the AI tool catalogue) reads and writes
 * through its own narrow seams and is not yet part of the selection; those
 * rows are listed as unfinished in the conversion report rather than declared
 * here with no memory twin behind them. `ingestionTemplates` is the one row
 * of that half already converted — both tiers exist, so the REST family's
 * seven template operations no longer need the ~100-operation facade.
 */
export interface GovernanceRepositories {
  readonly adminWorkspaceViewAudit: AdminWorkspaceViewAuditRepository;
  readonly anomalyRules: AnomalyRuleRepository;
  readonly departments: DepartmentRepository;
  readonly directory: GovernanceDirectoryRepository;
  readonly ingestionTemplates: IngestionTemplateRepository;
  readonly ocsfExports: GovernanceOcsfExportRepository;
  readonly personalVirtualKeys: PersonalVirtualKeyRepository;
  readonly routingPolicies: RoutingPolicyRepository;
  readonly sessionPolicies: OrganizationSessionPolicyRepository;
  readonly setupState: GovernanceSetupStateRepository;
  readonly spendSpikeAnomalies: SpendSpikeAnomalyRepository;
  readonly supportContacts: OrganizationSupportContactRepository;
}

/**
 * The ClickHouse-backed rows the governance module owns, chosen once at
 * boot — a second tier alongside {@link GovernanceRepositories} because the
 * two live behind different process members (`prisma` vs `clickhouse`) and
 * different registries, not because the rows differ in kind. One class can
 * (and does) answer more than one of the app's declared reader/writer
 * interfaces — `anomalySpend` is both an `AnomalySpendReader` and a
 * `GovernanceKpiContributionWriter`, `ocsfEvents` both a
 * `GovernanceOcsfEventsReader` and a `GovernanceOcsfEventWriter`, and
 * `traceActivity` both a `GovernanceSetupActivityReader` and a
 * `QuarantineTraceActivityReader` — the app hands the same instance to
 * whichever `GovernanceInfrastructure` member asks for it.
 */
export interface GovernanceClickHouseRepositories {
  readonly anomalySpend: AnomalySpendReader & GovernanceKpiContributionWriter;
  readonly ocsfEvents: GovernanceOcsfEventsReader &
    GovernanceOcsfEventWriter &
    OcsfEventBatchWriter &
    OcsfSeatReportReader;
  readonly traceActivity: GovernanceSetupActivityReader & QuarantineTraceActivityReader;
  readonly personalUsage: PersonalUsageReader;
  readonly gatewaySpend: GatewaySpendRepository;
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
