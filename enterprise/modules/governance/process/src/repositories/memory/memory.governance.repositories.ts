// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GovernanceRepositories } from "../governance.repositories.ts";
import { MemoryActivityMonitorRepository } from "./memory.activity-monitor.repository.ts";
import { MemoryAiToolCatalogRepository } from "./memory.ai-tool-catalog.repository.ts";
import { MemoryAnomalyRuleRepository } from "./memory.anomaly-rule.repository.ts";
import { MemoryDepartmentRepository } from "./memory.department.repository.ts";
import { MemoryDiscoveredAgentRepository } from "./memory.discovered-agent.repository.ts";
import { MemoryDiscoveredPeopleStore } from "./memory.discovered-people.store.ts";
import { MemoryDiscoveredPersonRepository } from "./memory.discovered-person.repository.ts";
import { MemoryErasedIdentifierSuppressionRepository } from "./memory.erased-identifier-suppression.repository.ts";
import { MemoryGovernanceCostRollupRepository } from "./memory.governance-cost-rollup.repository.ts";
import { MemoryGovernanceOcsfExportRepository } from "./memory.governance-ocsf-export.repository.ts";
import { MemoryGovernanceSetupStateRepository } from "./memory.governance-setup-state.repository.ts";
import { MemoryGovernanceTenantHistoryRepository } from "./memory.governance-tenant-history.repository.ts";
import { MemoryGovernanceStore } from "./memory.governance.store.ts";
import { MemoryIdentityMatchSuggestionRepository } from "./memory.identity-match-suggestion.repository.ts";
import { MemoryIdentityMatchRepository } from "./memory.identity-match.repository.ts";
import { MemoryIngestionPullLifecycleRepository } from "./memory.ingestion-pull-lifecycle.repository.ts";
import { MemoryIngestionPullRunRepository } from "./memory.ingestion-pull-run.repository.ts";
import { MemoryIngestionSourceRepository } from "./memory.ingestion-source.repository.ts";
import { MemoryIngestionTemplateRepository } from "./memory.ingestion-template.repository.ts";
import { MemoryOcsfEventsRepository } from "./memory.ocsf-events.repository.ts";
import { MemoryOrganizationSupportContactRepository } from "./memory.organization-support-contact.repository.ts";
import { MemoryRollupErasureRepository } from "./memory.rollup-erasure.repository.ts";
import { MemorySpendSpikeAnomalyRepository } from "./memory.spend-spike-anomaly.repository.ts";

/** The "memory" tier: every governance repository, with no database behind it. */
export class MemoryGovernanceRepositories {
  static readonly requires = [] as const;

  static create(): GovernanceRepositories {
    // One store behind every row, the way one Postgres schema serves the
    // Prisma tier: a department written here is what the directory and the
    // support-contact rows answer from.
    const store = MemoryGovernanceStore.create();
    const people = MemoryDiscoveredPeopleStore.create();

    return {
      activityMonitor: MemoryActivityMonitorRepository.create(),
      aiTools: MemoryAiToolCatalogRepository.create(),
      anomalyRules: MemoryAnomalyRuleRepository.create(store),
      departments: MemoryDepartmentRepository.create(store),
      discoveredAgents: MemoryDiscoveredAgentRepository.create(people),
      discoveredPeople: MemoryDiscoveredPersonRepository.create(people),
      erasedIdentifierSuppressions: MemoryErasedIdentifierSuppressionRepository.create(people),
      identityMatches: MemoryIdentityMatchRepository.create(people),
      identityMatchSuggestions: MemoryIdentityMatchSuggestionRepository.create(people),
      ingestionPullLifecycle: MemoryIngestionPullLifecycleRepository.create(),
      ingestionPullRuns: MemoryIngestionPullRunRepository.create(),
      ingestionSources: MemoryIngestionSourceRepository.create(),
      ingestionTemplates: MemoryIngestionTemplateRepository.create(store),
      costRollup: MemoryGovernanceCostRollupRepository.create(),
      ocsfEvents: MemoryOcsfEventsRepository.create(),
      ocsfExports: MemoryGovernanceOcsfExportRepository.create(store),
      rollupErasure: MemoryRollupErasureRepository.create(),
      setupState: MemoryGovernanceSetupStateRepository.create(),
      spendSpikeAnomalies: MemorySpendSpikeAnomalyRepository.create(store),
      supportContacts: MemoryOrganizationSupportContactRepository.create(store),
      tenantHistory: MemoryGovernanceTenantHistoryRepository.create(people),
    };
  }
}
