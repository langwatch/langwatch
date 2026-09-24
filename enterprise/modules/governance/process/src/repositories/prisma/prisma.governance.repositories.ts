// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { GovernanceRepositories } from "../governance.repositories.ts";
import { PrismaAdminWorkspaceViewAuditRepository } from "./prisma.admin-workspace-view-audit.repository.ts";
import { PrismaAnomalyRuleRepository } from "./prisma.anomaly-rule.repository.ts";
import { PrismaDepartmentRepository } from "./prisma.department.repository.ts";
import { PrismaDiscoveredAgentRepository } from "./prisma.discovered-agent.repository.ts";
import { PrismaDiscoveredPersonRepository } from "./prisma.discovered-person.repository.ts";
import { PrismaErasedIdentifierSuppressionRepository } from "./prisma.erased-identifier-suppression.repository.ts";
import { PrismaGovernanceDirectoryRepository } from "./prisma.governance-directory.repository.ts";
import { PrismaPersonalVirtualKeyRepository } from "./prisma.governance-personal-key.repository.ts";
import { PrismaRoutingPolicyRepository } from "./prisma.governance-routing.repository.ts";
import { PrismaGovernanceSetupStateRepository } from "./prisma.governance-setup-state.repository.ts";
import { PrismaGovernanceTenantHistoryRepository } from "./prisma.governance-tenant-history.repository.ts";
import { PrismaIdentityMatchSuggestionRepository } from "./prisma.identity-match-suggestion.repository.ts";
import { PrismaIdentityMatchRepository } from "./prisma.identity-match.repository.ts";
import { PrismaIngestionTemplateRepository } from "./prisma.ingestion-template.repository.ts";
import { PrismaGovernanceOcsfExportRepository } from "./prisma.ocsf-export.repository.ts";
import { PrismaOrganizationSessionPolicyRepository } from "./prisma.organization-session-policy.repository.ts";
import { PrismaOrganizationSupportContactRepository } from "./prisma.organization-support-contact.repository.ts";
import { PrismaSpendSpikeAnomalyRepository } from "./prisma.spend-spike-anomaly.repository.ts";

/**
 * The live tier: every governance row this module owns, read and
 * written through the one tenant-keyed Prisma client the process holds.
 */
export class PostgresGovernanceRepositories {
  static readonly requires = ["prisma"] as const;

  static create(members: Readonly<{ prisma: PrismaClient }>): GovernanceRepositories {
    const { prisma } = members;

    return {
      adminWorkspaceViewAudit: PrismaAdminWorkspaceViewAuditRepository.create(prisma),
      anomalyRules: PrismaAnomalyRuleRepository.create(prisma),
      departments: PrismaDepartmentRepository.create(prisma),
      directory: PrismaGovernanceDirectoryRepository.create(prisma),
      discoveredAgents: PrismaDiscoveredAgentRepository.create(prisma),
      discoveredPeople: PrismaDiscoveredPersonRepository.create(prisma),
      erasedIdentifierSuppressions: PrismaErasedIdentifierSuppressionRepository.create(prisma),
      identityMatches: PrismaIdentityMatchRepository.create(prisma),
      identityMatchSuggestions: PrismaIdentityMatchSuggestionRepository.create(prisma),
      ingestionTemplates: PrismaIngestionTemplateRepository.create(prisma),
      ocsfExports: PrismaGovernanceOcsfExportRepository.create(prisma),
      personalVirtualKeys: PrismaPersonalVirtualKeyRepository.create(prisma),
      routingPolicies: PrismaRoutingPolicyRepository.create(prisma),
      sessionPolicies: PrismaOrganizationSessionPolicyRepository.create(prisma),
      setupState: PrismaGovernanceSetupStateRepository.create(prisma),
      spendSpikeAnomalies: PrismaSpendSpikeAnomalyRepository.create(prisma),
      supportContacts: PrismaOrganizationSupportContactRepository.create({ prisma }),
      tenantHistory: PrismaGovernanceTenantHistoryRepository.create(prisma),
    };
  }
}
