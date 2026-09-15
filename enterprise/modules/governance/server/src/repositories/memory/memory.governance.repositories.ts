// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GovernanceRepositories } from "../governance.repositories.ts";
import { MemoryAdminWorkspaceViewAuditRepository } from "./memory.admin-workspace-view-audit.repository.ts";
import { MemoryAnomalyRuleRepository } from "./memory.anomaly-rule.repository.ts";
import { MemoryDepartmentRepository } from "./memory.department.repository.ts";
import { MemoryGovernanceDirectoryRepository } from "./memory.governance-directory.repository.ts";
import { MemoryGovernanceOcsfExportRepository } from "./memory.governance-ocsf-export.repository.ts";
import { MemoryGovernanceSetupStateRepository } from "./memory.governance-setup-state.repository.ts";
import { MemoryGovernanceStore } from "./memory-governance.store.ts";
import { MemoryOrganizationSessionPolicyRepository } from "./memory.organization-session-policy.repository.ts";
import { MemoryOrganizationSupportContactRepository } from "./memory.organization-support-contact.repository.ts";
import { MemoryPersonalVirtualKeyRepository } from "./memory.governance-personal-key.repository.ts";
import { MemoryRoutingPolicyRepository } from "./memory.governance-routing.repository.ts";
import { MemorySpendSpikeAnomalyRepository } from "./memory.spend-spike-anomaly.repository.ts";

/** The "memory" tier: every governance repository, with no database behind it. */
export class MemoryGovernanceRepositories {
  static readonly requires = [] as const;

  static create(): GovernanceRepositories {
    // One store behind every row, the way one Postgres schema serves the
    // Prisma tier: a department written here is what the directory and the
    // support-contact rows answer from.
    const store = MemoryGovernanceStore.create();

    return {
      adminWorkspaceViewAudit: MemoryAdminWorkspaceViewAuditRepository.create(),
      anomalyRules: MemoryAnomalyRuleRepository.create(store),
      departments: MemoryDepartmentRepository.create(store),
      directory: MemoryGovernanceDirectoryRepository.create(store),
      ocsfExports: MemoryGovernanceOcsfExportRepository.create(store),
      personalVirtualKeys: MemoryPersonalVirtualKeyRepository.create(store),
      routingPolicies: MemoryRoutingPolicyRepository.create(store),
      sessionPolicies: MemoryOrganizationSessionPolicyRepository.create(),
      setupState: MemoryGovernanceSetupStateRepository.create(),
      spendSpikeAnomalies: MemorySpendSpikeAnomalyRepository.create(store),
      supportContacts: MemoryOrganizationSupportContactRepository.create(store),
    };
  }
}
