import type { PlanInfo } from "../subscriptionHandler";
import type { ILicenseEnforcementRepository } from "./license-enforcement.repository";
import type { LimitCheckResult, LimitType } from "./types";
import { LimitExceededError } from "./errors";
import { assertNever } from "../../utils/typescript";

/**
 * Minimal user type for plan resolution.
 * Matches what SubscriptionHandler expects.
 */
export type MinimalUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

/**
 * Narrow interface for plan retrieval.
 * Follows Interface Segregation Principle (ISP) - only exposes what we need.
 */
export interface PlanProvider {
  getActivePlan(organizationId: string, user?: MinimalUser): Promise<PlanInfo>;
}

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
    const plan = await this.planProvider.getActivePlan(organizationId, user);

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
   * Exhaustive switch ensures all types are handled.
   */
  private async getCountForType(
    organizationId: string,
    limitType: LimitType,
  ): Promise<number> {
    switch (limitType) {
      case "workflows":
        return this.repository.getWorkflowCount(organizationId);
      case "prompts":
        return this.repository.getPromptCount(organizationId);
      case "evaluators":
        return this.repository.getEvaluatorCount(organizationId);
      case "scenarios":
        return this.repository.getScenarioCount(organizationId);
      case "projects":
        return this.repository.getProjectCount(organizationId);
      case "members":
        return this.repository.getMemberCount(organizationId);
      default:
        return assertNever(limitType);
    }
  }

  /**
   * Gets the maximum allowed for a resource type from the plan.
   * Exhaustive switch ensures all types are handled.
   */
  private getMaxForType(plan: PlanInfo, limitType: LimitType): number {
    switch (limitType) {
      case "workflows":
        return plan.maxWorkflows;
      case "prompts":
        return plan.maxPrompts;
      case "evaluators":
        return plan.maxEvaluators;
      case "scenarios":
        return plan.maxScenarios;
      case "projects":
        return plan.maxProjects;
      case "members":
        return plan.maxMembers;
      default:
        return assertNever(limitType);
    }
  }
}
