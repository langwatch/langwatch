// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { GovernanceRepositories } from "../governance.repositories.ts";
import { PrismaAdminWorkspaceViewAuditRepository } from "./prisma.admin-workspace-view-audit.repository.ts";
import { PrismaAnomalyRuleRepository } from "./prisma.anomaly-rule.repository.ts";
import { PrismaDepartmentRepository } from "./prisma.department.repository.ts";
import { PrismaGovernanceDirectoryRepository } from "./prisma.governance-directory.repository.ts";
import { PrismaGovernanceOcsfExportRepository } from "./prisma.ocsf-export.repository.ts";
import { PrismaGovernanceSetupStateRepository } from "./prisma.governance-setup-state.repository.ts";
import { PrismaOrganizationSessionPolicyRepository } from "./prisma.organization-session-policy.repository.ts";
import { PrismaOrganizationSupportContactRepository } from "./prisma.organization-support-contact.repository.ts";
import { PrismaPersonalVirtualKeyRepository } from "./prisma.governance-personal-key.repository.ts";
import { PrismaRoutingPolicyRepository } from "./prisma.governance-routing.repository.ts";
import { PrismaSpendSpikeAnomalyRepository } from "./prisma.spend-spike-anomaly.repository.ts";

/**
 * The "postgres" tier: every governance row this module owns, read and
 * written through the one tenant-keyed Prisma client the process holds.
 */
export class PostgresGovernanceRepositories {
  static readonly requires = ["prisma"] as const;

  static create(infrastructure: Readonly<{ prisma: PrismaClient }>): GovernanceRepositories {
    const { prisma } = infrastructure;

    return {
      adminWorkspaceViewAudit: PrismaAdminWorkspaceViewAuditRepository.create(prisma),
      anomalyRules: PrismaAnomalyRuleRepository.create(prisma),
      departments: PrismaDepartmentRepository.create(prisma),
      directory: PrismaGovernanceDirectoryRepository.create(prisma),
      ocsfExports: PrismaGovernanceOcsfExportRepository.create(prisma),
      personalVirtualKeys: PrismaPersonalVirtualKeyRepository.create(prisma),
      routingPolicies: PrismaRoutingPolicyRepository.create(prisma),
      sessionPolicies: PrismaOrganizationSessionPolicyRepository.create(prisma),
      setupState: PrismaGovernanceSetupStateRepository.create(prisma),
      spendSpikeAnomalies: PrismaSpendSpikeAnomalyRepository.create(prisma),
      supportContacts: PrismaOrganizationSupportContactRepository.create({ prisma }),
    };
  }
}
