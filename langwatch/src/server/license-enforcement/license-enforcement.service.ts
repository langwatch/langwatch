import type { PlanInfo } from "../../../ee/licensing/planInfo";
import type { PlanProvider } from "../app-layer/subscription/plan-provider";
import type { ILicenseEnforcementRepository } from "./license-enforcement.repository";
import type { LimitCheckResult, LimitType } from "./types";
import { limitTypes } from "./types";
import { LimitExceededError } from "./errors";

/**
 * Configuration for a single limit type.
 * Associates each LimitType with functions to get count and max.
 */
type LimitTypeConfig = {
  getCount: (
    repo: ILicenseEnforcementRepository,
    orgId: string,
  ) => Promise<number>;
  getMax: (plan: PlanInfo) => number;
};

/**
 * Mapping from LimitType to its configuration.
 * Adding a new LimitType to the union requires adding it here (compile-time enforced).
 *
 * Open/Closed Principle (OCP): To add a new limit type:
 * 1. Add the type to limitTypes array in types.ts
 * 2. Add the configuration entry here
 * No need to modify any switch statements.
 */
const LIMIT_TYPE_CONFIG: Record<LimitType, LimitTypeConfig> = {
  workflows: {
    getCount: (repo, orgId) => repo.getWorkflowCount(orgId),
    getMax: (plan) => plan.maxWorkflows,
  },
  prompts: {
    getCount: (repo, orgId) => repo.getPromptCount(orgId),
    getMax: (plan) => plan.maxPrompts,
  },
  evaluators: {
    getCount: (repo, orgId) => repo.getEvaluatorCount(orgId),
    getMax: (plan) => plan.maxEvaluators,
  },
  scenarios: {
    getCount: (repo, orgId) => repo.getActiveScenarioCount(orgId),
    getMax: (plan) => plan.maxScenarios,
  },
  projects: {
    getCount: (repo, orgId) => repo.getProjectCount(orgId),
    getMax: (plan) => plan.maxProjects,
  },
  teams: {
    getCount: (repo, orgId) => repo.getTeamCount(orgId),
    getMax: (plan) => plan.maxTeams,
  },
  members: {
    getCount: (repo, orgId) => repo.getMemberCount(orgId),
    getMax: (plan) => plan.maxMembers,
  },
  membersLite: {
    getCount: (repo, orgId) => repo.getMembersLiteCount(orgId),
    getMax: (plan) => plan.maxMembersLite,
  },
  agents: {
    getCount: (repo, orgId) => repo.getAgentCount(orgId),
    getMax: (plan) => plan.maxAgents,
  },
  experiments: {
    getCount: (repo, orgId) => repo.getExperimentCount(orgId),
    getMax: (plan) => plan.maxExperiments,
  },
  onlineEvaluations: {
    getCount: (repo, orgId) => repo.getOnlineEvaluationCount(orgId),
    getMax: (plan) => plan.maxOnlineEvaluations,
  },
  datasets: {
    getCount: (repo, orgId) => repo.getDatasetCount(orgId),
    getMax: (plan) => plan.maxDatasets,
  },
  dashboards: {
    getCount: (repo, orgId) => repo.getDashboardCount(orgId),
    getMax: (plan) => plan.maxDashboards,
  },
  customGraphs: {
    getCount: (repo, orgId) => repo.getCustomGraphCount(orgId),
    getMax: (plan) => plan.maxCustomGraphs,
  },
  automations: {
    getCount: (repo, orgId) => repo.getAutomationCount(orgId),
    getMax: (plan) => plan.maxAutomations,
  },
};

// Compile-time check: ensure all LimitTypes are covered in config
// This will fail to compile if a LimitType is added but not configured
type _AssertAllTypesConfigured = (typeof limitTypes)[number] extends keyof typeof LIMIT_TYPE_CONFIG
  ? keyof typeof LIMIT_TYPE_CONFIG extends (typeof limitTypes)[number]
    ? true
    : never
  : never;
const _typeCheck: _AssertAllTypesConfigured = true;
void _typeCheck; // Suppress unused variable warning

/**
 * Minimal user type for plan resolution in license enforcement.
 * Structurally compatible with app-layer PlanProviderUser (MinimalUser
 * is a subtype since its required `id` satisfies PlanProviderUser's optional `id`).
 */
export type MinimalUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

/**
 * Service for checking and enforcing license limits.
 *
 * Business logic layer that:
 * - Coordinates between plan provider and resource counting
 * - Applies limit checking rules
 * - Throws domain errors when limits are exceeded
 */
export class LicenseEnforcementService {
  constructor(
    private readonly repository: ILicenseEnforcementRepository,
    private readonly planProvider: PlanProvider,
  ) {}

  /**
   * Checks if an organization can create another resource of the given type.
   *
   * @param organizationId - The organization to check
   * @param limitType - The type of resource being checked
   * @param user - Optional user for plan resolution
   * @returns Result containing allowed status and current/max counts
   */
  async checkLimit(
    organizationId: string,
    limitType: LimitType,
    user?: MinimalUser,
  ): Promise<LimitCheckResult> {
    const plan = await this.planProvider.getActivePlan({ organizationId, user });

    // If plan has override flag, skip enforcement (e.g., unlimited OSS plan)
    if (plan.overrideAddingLimitations) {
      return {
        allowed: true,
        current: 0,
        max: this.getMaxForType(plan, limitType),
        limitType,
      };
    }

    const current = await this.getCountForType(organizationId, limitType);
    const max = this.getMaxForType(plan, limitType);

    return { allowed: current < max, current, max, limitType };
  }

  /**
   * Enforces a limit by throwing an error if exceeded.
   * Use this before creating resources to prevent going over limits.
   *
   * @param organizationId - The organization to check
   * @param limitType - The type of resource being created
   * @param user - Optional user for plan resolution
   * @throws LimitExceededError if the limit is reached
   */
  async enforceLimit(
    organizationId: string,
    limitType: LimitType,
    user?: MinimalUser,
  ): Promise<void> {
    const result = await this.checkLimit(organizationId, limitType, user);
    if (!result.allowed) {
      throw new LimitExceededError(limitType, result.current, result.max);
    }
  }

  /**
   * Gets the current count for a resource type.
   * Uses LIMIT_TYPE_CONFIG mapping for OCP compliance.
   */
  private async getCountForType(
    organizationId: string,
    limitType: LimitType,
  ): Promise<number> {
    const config = LIMIT_TYPE_CONFIG[limitType];
    return config.getCount(this.repository, organizationId);
  }

  /**
   * Gets the maximum allowed for a resource type from the plan.
   * Uses LIMIT_TYPE_CONFIG mapping for OCP compliance.
   */
  private getMaxForType(plan: PlanInfo, limitType: LimitType): number {
    const config = LIMIT_TYPE_CONFIG[limitType];
    return config.getMax(plan);
  }
}
