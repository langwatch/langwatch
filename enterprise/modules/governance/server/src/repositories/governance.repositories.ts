// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AnomalyRulePort } from "../ports/anomaly-rule.port.ts";
import type { DepartmentPort } from "../ports/department.port.ts";
import type { GovernanceDirectoryPort } from "../ports/governance-directory.port.ts";
import type { GovernanceOcsfExportRepository } from "../ports/ocsf-export.port.ts";
import type { GovernanceSetupStateRepository } from "../ports/governance-setup-state.port.ts";
import type { OrganizationSessionPolicyPort } from "../ports/session-policy.port.ts";
import type { PersonalVirtualKeyRepository } from "../ports/personal-virtual-key.port.ts";
import type { RoutingPolicyPort } from "../ports/routing-policy.port.ts";
import type { SpendSpikeAnomalyRepository } from "../ports/spend-spike-anomaly.port.ts";
import type { OrganizationSupportContactRepository } from "./organization-support-contact.repository.ts";

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
