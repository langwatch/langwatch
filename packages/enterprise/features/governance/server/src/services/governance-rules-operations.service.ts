// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { AnomalyRuleService } from "./anomaly-rule.service";
import type { GovernanceDepartmentService } from "./governance-department.service";
import type { PostgresGovernancePolicyService } from "./governance-policy.service";
import type { GovernanceAiToolsService } from "./governance-ai-tools.service";

/** Private cohesive collaborator for the rules operation set. */
export class GovernanceRulesOperationsService {
  private constructor(
    private readonly anomalyRules: AnomalyRuleService,
    private readonly departments: GovernanceDepartmentService,
    private readonly policy: PostgresGovernancePolicyService,
    private readonly aiTools: GovernanceAiToolsService,
  ) {}

  static create(
    anomalyRules: AnomalyRuleService,
    departments: GovernanceDepartmentService,
    policy: PostgresGovernancePolicyService,
    aiTools: GovernanceAiToolsService,
  ): GovernanceRulesOperationsService {
    return new GovernanceRulesOperationsService(
      anomalyRules,
      departments,
      policy,
      aiTools,
    );
  }

  readonly anomalyRuleList: GovernanceService["anomalyRuleList"] = (...args) =>
    this.anomalyRules.list(...args);

  readonly tryFindAnomalyRuleById: GovernanceService["tryFindAnomalyRuleById"] = (
    ...args
  ) => this.anomalyRules.tryFindById(...args);

  readonly anomalyRuleGetById: GovernanceService["anomalyRuleGetById"] = (...args) =>
    this.anomalyRules.getById(...args);

  readonly anomalyRuleCreate: GovernanceService["anomalyRuleCreate"] = (...args) =>
    this.anomalyRules.createRule(...args);

  readonly anomalyRuleUpdate: GovernanceService["anomalyRuleUpdate"] = (...args) =>
    this.anomalyRules.updateRule(...args);

  readonly anomalyRuleArchive: GovernanceService["anomalyRuleArchive"] = (...args) =>
    this.anomalyRules.archive(...args);

  readonly departmentList: GovernanceService["departmentList"] = (...args) =>
    this.departments.list(...args);

  readonly departmentAssignments: GovernanceService["departmentAssignments"] = (
    ...args
  ) => this.departments.assignments(...args);

  readonly departmentCreate: GovernanceService["departmentCreate"] = (...args) =>
    this.departments.create(...args);

  readonly departmentResolveByNameOrCreate: GovernanceService["departmentResolveByNameOrCreate"] =
    (...args) => this.departments.resolveByNameOrCreate(...args);

  readonly departmentRename: GovernanceService["departmentRename"] = (...args) =>
    this.departments.rename(...args);

  readonly departmentArchive: GovernanceService["departmentArchive"] = (...args) =>
    this.departments.archive(...args);

  readonly departmentAssignUser: GovernanceService["departmentAssignUser"] = (...args) =>
    this.departments.assignUser(...args);

  readonly departmentAssignTeam: GovernanceService["departmentAssignTeam"] = (...args) =>
    this.departments.assignTeam(...args);

  readonly departmentAssignProject: GovernanceService["departmentAssignProject"] = (
    ...args
  ) => this.departments.assignProject(...args);

  readonly resolveSourceNonBillable: GovernanceService["resolveSourceNonBillable"] = (
    ...args
  ) => this.policy.resolveSourceNonBillable(...args);

  readonly resolveTraceDepartment: GovernanceService["resolveTraceDepartment"] = (
    ...args
  ) => this.policy.resolveTraceDepartment(...args);

  readonly aiToolListForUser: GovernanceService["aiToolListForUser"] = (...args) =>
    this.aiTools.listForUser(...args);

  readonly aiToolListForAdmin: GovernanceService["aiToolListForAdmin"] = (...args) =>
    this.aiTools.listForAdmin(...args);

  readonly tryFindAiToolById: GovernanceService["tryFindAiToolById"] = (...args) =>
    this.aiTools.tryFindById(...args);

  readonly aiToolGetById: GovernanceService["aiToolGetById"] = (...args) =>
    this.aiTools.getById(...args);

  readonly aiToolCreate: GovernanceService["aiToolCreate"] = (...args) =>
    this.aiTools.create(...args);

  readonly aiToolUpdate: GovernanceService["aiToolUpdate"] = (...args) =>
    this.aiTools.update(...args);

  readonly aiToolRemove: GovernanceService["aiToolRemove"] = (...args) =>
    this.aiTools.remove(...args);

  readonly aiToolEnsureDefaultCatalog: GovernanceService["aiToolEnsureDefaultCatalog"] = (
    ...args
  ) => this.aiTools.ensureDefaultCatalog(...args);

  readonly aiToolSeedStarterPack: GovernanceService["aiToolSeedStarterPack"] = (
    ...args
  ) => this.aiTools.seedStarterPack(...args);

  readonly aiToolListConfiguredProvidersForUser: GovernanceService["aiToolListConfiguredProvidersForUser"] =
    (...args) => this.aiTools.listConfiguredProvidersForUser(...args);

  readonly aiToolListProviderOptionsForAdmin: GovernanceService["aiToolListProviderOptionsForAdmin"] =
    (...args) => this.aiTools.listProviderOptionsForAdmin(...args);

  readonly aiToolListRoutingPolicyOptionsForAdmin: GovernanceService["aiToolListRoutingPolicyOptionsForAdmin"] =
    (...args) => this.aiTools.listRoutingPolicyOptionsForAdmin(...args);

  readonly aiToolReorder: GovernanceService["aiToolReorder"] = (...args) =>
    this.aiTools.reorder(...args);

  readonly aiToolResolvePolicyOverrides: GovernanceService["aiToolResolvePolicyOverrides"] =
    (...args) => this.aiTools.resolveToolPolicyOverrides(...args);

  readonly aiToolResolvePolicyMap: GovernanceService["aiToolResolvePolicyMap"] = (
    ...args
  ) => this.aiTools.resolveToolPolicyMap(...args);

  readonly aiToolResolvePolicy: GovernanceService["aiToolResolvePolicy"] = (...args) =>
    this.aiTools.resolveToolPolicy(...args);

  readonly aiToolResolveCliCatalogForUser: GovernanceService["aiToolResolveCliCatalogForUser"] =
    (...args) => this.aiTools.resolveCliCatalogForUser(...args);
}
