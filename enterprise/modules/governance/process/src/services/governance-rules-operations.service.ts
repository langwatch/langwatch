import type {
  GovernanceOtlpPolicyInput,
  GovernanceOtlpReceiverPolicies,
} from "@langwatch/enterprise-governance-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GovernanceApi } from "@langwatch/enterprise-governance-contract";
import type { AnomalyRuleService } from "./anomaly-rule.service.ts";
import type { PostgresGovernancePolicyService } from "./governance-policy.service.ts";
import type { DepartmentService } from "./department.service.ts";
import type { DefaultGovernanceAiToolCatalogService } from "./ai-tool-catalog.service.ts";

/** Private cohesive collaborator for the rules operation set. */
export class GovernanceRulesOperationsService {
  private constructor(
    private readonly anomalyRules: AnomalyRuleService,
    private readonly departments: DepartmentService,
    private readonly policy: PostgresGovernancePolicyService,
    private readonly aiTools: DefaultGovernanceAiToolCatalogService,
  ) {}

  static create(
    anomalyRules: AnomalyRuleService,
    departments: DepartmentService,
    policy: PostgresGovernancePolicyService,
    aiTools: DefaultGovernanceAiToolCatalogService,
  ): GovernanceRulesOperationsService {
    return new GovernanceRulesOperationsService(anomalyRules, departments, policy, aiTools);
  }

  readonly anomalyRuleList: GovernanceApi["anomalyRuleList"] = (...args) =>
    this.anomalyRules.list(...args);

  readonly findAnomalyRuleById: GovernanceApi["findAnomalyRuleById"] = (...args) =>
    this.anomalyRules.findById(...args);

  readonly anomalyRuleGetById: GovernanceApi["anomalyRuleGetById"] = (...args) =>
    this.anomalyRules.getById(...args);

  readonly anomalyRuleCreate: GovernanceApi["anomalyRuleCreate"] = (...args) =>
    this.anomalyRules.createRule(...args);

  readonly anomalyRuleUpdate: GovernanceApi["anomalyRuleUpdate"] = (...args) =>
    this.anomalyRules.updateRule(...args);

  readonly anomalyRuleArchive: GovernanceApi["anomalyRuleArchive"] = (...args) =>
    this.anomalyRules.archive(...args);

  readonly departmentList: GovernanceApi["departmentList"] = (...args) =>
    this.departments.getAll({ organizationId: args[0] });

  readonly departmentAssignments: GovernanceApi["departmentAssignments"] = (...args) =>
    this.departments.getAssignments({ organizationId: args[0] });

  readonly departmentCreate: GovernanceApi["departmentCreate"] = (...args) =>
    this.departments.create(...args);

  readonly departmentResolveByNameOrCreate: GovernanceApi["departmentResolveByNameOrCreate"] = (
    ...args
  ) => this.departments.resolveByNameOrCreate(...args);

  readonly departmentRename: GovernanceApi["departmentRename"] = (...args) =>
    this.departments.rename(...args);

  readonly departmentArchive: GovernanceApi["departmentArchive"] = (...args) =>
    this.departments.archive(...args);

  readonly departmentAssignUser: GovernanceApi["departmentAssignUser"] = (...args) =>
    this.departments.assignUser(...args);

  readonly departmentAssignTeam: GovernanceApi["departmentAssignTeam"] = (...args) =>
    this.departments.assignTeam(...args);

  readonly departmentAssignProject: GovernanceApi["departmentAssignProject"] = (...args) =>
    this.departments.assignProject(...args);

  resolveOtlpReceiverPolicies(
    input: GovernanceOtlpPolicyInput,
  ): Promise<GovernanceOtlpReceiverPolicies> {
    return this.policy.resolveOtlpReceiverPolicies(input);
  }

  readonly resolveSourceNonBillable: GovernanceApi["resolveSourceNonBillable"] = (...args) =>
    this.policy.resolveSourceNonBillable(...args);

  readonly resolveTraceDepartment: GovernanceApi["resolveTraceDepartment"] = (...args) =>
    this.policy.resolveTraceDepartment(...args);

  readonly aiToolListForUser: GovernanceApi["aiToolListForUser"] = (...args) =>
    this.aiTools.listForUser(...args);

  readonly aiToolListForAdmin: GovernanceApi["aiToolListForAdmin"] = (...args) =>
    this.aiTools.listForAdmin(...args);

  readonly findAiToolById: GovernanceApi["findAiToolById"] = (...args) =>
    this.aiTools.findById(...args);

  readonly aiToolGetById: GovernanceApi["aiToolGetById"] = (...args) =>
    this.aiTools.getById(...args);

  readonly aiToolCreate: GovernanceApi["aiToolCreate"] = (...args) =>
    this.aiTools.create(...args);

  readonly aiToolUpdate: GovernanceApi["aiToolUpdate"] = (...args) =>
    this.aiTools.update(...args);

  readonly aiToolRemove: GovernanceApi["aiToolRemove"] = (...args) =>
    this.aiTools.remove(...args);

  readonly aiToolEnsureDefaultCatalog: GovernanceApi["aiToolEnsureDefaultCatalog"] = (
    ...args
  ) => this.aiTools.ensureDefaultCatalog(...args);

  readonly aiToolSeedStarterPack: GovernanceApi["aiToolSeedStarterPack"] = (...args) =>
    this.aiTools.seedStarterPack(...args);

  readonly aiToolListConfiguredProvidersForUser: GovernanceApi["aiToolListConfiguredProvidersForUser"] =
    (...args) => this.aiTools.listConfiguredProvidersForUser(...args);

  readonly aiToolListProviderOptionsForAdmin: GovernanceApi["aiToolListProviderOptionsForAdmin"] =
    (...args) => this.aiTools.listProviderOptionsForAdmin(...args);

  readonly aiToolListRoutingPolicyOptionsForAdmin: GovernanceApi["aiToolListRoutingPolicyOptionsForAdmin"] =
    (...args) => this.aiTools.listRoutingPolicyOptionsForAdmin(...args);

  readonly aiToolReorder: GovernanceApi["aiToolReorder"] = (...args) =>
    this.aiTools.reorder(...args);

  readonly aiToolResolvePolicyOverrides: GovernanceApi["aiToolResolvePolicyOverrides"] = (
    ...args
  ) => this.aiTools.resolveToolPolicyOverrides(...args);

  readonly aiToolResolvePolicyMap: GovernanceApi["aiToolResolvePolicyMap"] = (...args) =>
    this.aiTools.resolveToolPolicyMap(...args);

  readonly aiToolResolvePolicy: GovernanceApi["aiToolResolvePolicy"] = (...args) =>
    this.aiTools.resolveToolPolicy(...args);

  readonly aiToolResolveCliCatalogForUser: GovernanceApi["aiToolResolveCliCatalogForUser"] = (
    ...args
  ) => this.aiTools.resolveCliCatalogForUser(...args);
}
