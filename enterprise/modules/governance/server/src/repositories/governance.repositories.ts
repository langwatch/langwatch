// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AdminWorkspaceViewAuditRepository } from "./audit/admin-workspace-view-audit.repository.ts";
import type { AnomalyRulePort } from "./policy/anomaly-rule.repository.ts";
import type { DepartmentPort } from "./directory/department.repository.ts";
import type { GovernanceDirectoryPort } from "./directory/governance-directory.repository.ts";
import type { GovernanceOcsfExportRepository } from "./audit/governance-setup-state.repository.ts";
import type { GovernanceSetupStateRepository } from "./audit/governance-setup-state.repository.ts";
import type { OrganizationSessionPolicyPort } from "./policy/session-policy.repository.ts";
import type { PersonalVirtualKeyRepository } from "./directory/personal-virtual-key.repository.ts";
import type { RoutingPolicyPort } from "./policy/routing-policy.repository.ts";
import type { SpendSpikeAnomalyRepository } from "./policy/spend-spike-anomaly.repository.ts";
import type { OrganizationSupportContactRepository } from "./directory/organization-support-contact.repository.ts";

/**
 * The rows the governance module owns, chosen once at boot.
 *
 * The ingestion-pull half of the module (sources, templates, activity
 * rollups, the pull-run projection and the AI tool catalogue) reads and writes
 * through its own narrow seams and is not yet part of the selection; those
 * rows are listed as unfinished in the conversion report rather than declared
 * here with no memory twin behind them.
 */
export interface GovernanceRepositories {
  readonly adminWorkspaceViewAudit: AdminWorkspaceViewAuditRepository;
  readonly anomalyRules: AnomalyRulePort;
  readonly departments: DepartmentPort;
  readonly directory: GovernanceDirectoryPort;
  readonly ocsfExports: GovernanceOcsfExportRepository;
  readonly personalVirtualKeys: PersonalVirtualKeyRepository;
  readonly routingPolicies: RoutingPolicyPort;
  readonly sessionPolicies: OrganizationSessionPolicyPort;
  readonly setupState: GovernanceSetupStateRepository;
  readonly spendSpikeAnomalies: SpendSpikeAnomalyRepository;
  readonly supportContacts: OrganizationSupportContactRepository;
}
