import type { PlanInfo } from "../../../ee/licensing/planInfo";
import type { PlanProvider } from "../app-layer/subscription/plan-provider";
import { LimitExceededError } from "./errors";
import type { ILicenseEnforcementRepository } from "./license-enforcement.repository";
import type { LimitCheckResult, LimitType, limitTypes } from "./types";

/**
 * Where a limit type's current count comes from. Members, scenarios and
 * evaluators are Postgres counts; simulations are distinct scenario sets,
 * which live in ClickHouse and are counted by the usage service.
 */
export interface LimitCountSources {
  repository: ILicenseEnforcementRepository;
  countScenarioSets: (organizationId: string) => Promise<number>;
}

/**
 * Configuration for a single limit type.
 * Associates each LimitType with functions to get count and max.
 */
type LimitTypeConfig = {
  getCount: (sources: LimitCountSources, orgId: string) => Promise<number>;
  /** The plan's cap, or `undefined` when the plan sets none (uncapped). */
  getMax: (plan: PlanInfo) => number | undefined;
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
  members: {
    getCount: ({ repository }, orgId) => repository.getMemberCount(orgId),
    getMax: (plan) => plan.maxMembers,
  },
  membersLite: {
    getCount: ({ repository }, orgId) => repository.getMembersLiteCount(orgId),
    getMax: (plan) => plan.maxMembersLite,
  },
  scenarios: {
    getCount: ({ repository }, orgId) =>
      repository.getActiveScenarioCount(orgId),
    getMax: (plan) => plan.maxScenarios,
  },
  scenarioSets: {
    getCount: ({ countScenarioSets }, orgId) => countScenarioSets(orgId),
    getMax: (plan) => plan.maxScenarioSets,
  },
  evaluators: {
    getCount: ({ repository }, orgId) => repository.getEvaluatorCount(orgId),
    getMax: (plan) => plan.maxEvaluators,
  },
};

/**
 * Reported as `max` when the plan sets no cap. A finite number so it survives
 * JSON (Infinity serializes to null), and the same sentinel the seat views
 * read as unlimited.
 */
export const UNCAPPED_LIMIT = Number.MAX_SAFE_INTEGER;

/** The plan's cap for a limit type, or `undefined` when it sets none. */
export function planLimitFor(
  plan: PlanInfo,
  limitType: LimitType,
): number | undefined {
  return LIMIT_TYPE_CONFIG[limitType].getMax(plan);
}

// Compile-time check: ensure all LimitTypes are covered in config
// This will fail to compile if a LimitType is added but not configured
type _AssertAllTypesConfigured =
  (typeof limitTypes)[number] extends keyof typeof LIMIT_TYPE_CONFIG
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
  private readonly countSources: LimitCountSources;

  constructor(
    repository: ILicenseEnforcementRepository,
    private readonly planProvider: PlanProvider,
    countScenarioSets: (organizationId: string) => Promise<number> = () =>
      Promise.resolve(0),
  ) {
    this.countSources = { repository, countScenarioSets };
  }

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
    const plan = await this.planProvider.getActivePlan({
      organizationId,
      user,
    });

    const max = this.getMaxForType(plan, limitType);

    // If plan has override flag, skip enforcement (e.g., unlimited OSS plan)
    if (plan.overrideAddingLimitations) {
      return { allowed: true, current: 0, max, limitType };
    }

    // A plan that sets no cap for this type is uncapped: nothing to count.
    if (planLimitFor(plan, limitType) === undefined) {
      return { allowed: true, current: 0, max, limitType };
    }

    const current = await this.getCountForType(organizationId, limitType);

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
   * Enforces a limit using organizationId as the entry point.
   * Use this when you have an organizationId but no projectId
   * (e.g., project creation, team creation).
   *
   * @param params.organizationId - The organization to check
   * @param params.limitType - The type of resource being created
   * @param params.user - Optional user for plan resolution
   * @throws LimitExceededError if the limit is reached
   */
  async enforceLimitByOrganization({
    organizationId,
    limitType,
    user,
  }: {
    organizationId: string;
    limitType: LimitType;
    user?: MinimalUser;
  }): Promise<void> {
    return this.enforceLimit(organizationId, limitType, user);
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
    return config.getCount(this.countSources, organizationId);
  }

  /**
   * Gets the maximum allowed for a resource type from the plan, with
   * {@link UNCAPPED_LIMIT} standing in for a cap the plan does not set.
   */
  private getMaxForType(plan: PlanInfo, limitType: LimitType): number {
    return planLimitFor(plan, limitType) ?? UNCAPPED_LIMIT;
  }
}
