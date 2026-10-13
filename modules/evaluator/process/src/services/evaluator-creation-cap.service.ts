import { LimitExceededError } from "@langwatch/enterprise-licensing-contract";
import { planCreationCap, type EntitlementApi } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type { EvaluatorRepository } from "../repositories/evaluator.repository.ts";

type EvaluatorCreationCapDependencies = Readonly<{
  plans: Pick<EntitlementApi, "getActivePlan">;
  projects: Pick<ProjectApi, "getOrganizationId" | "listIdsByOrganization">;
  evaluators: Pick<EvaluatorRepository, "countActiveByProjects">;
}>;

/**
 * The cloud Free cap on custom evaluators. Only creating one more is refused;
 * plans that set no cap never count.
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
export class EvaluatorCreationCapService {
  static create(deps: EvaluatorCreationCapDependencies): EvaluatorCreationCapService {
    return new EvaluatorCreationCapService(deps);
  }

  private constructor(private readonly deps: EvaluatorCreationCapDependencies) {}

  /** @throws LimitExceededError (`evaluators`) once the organization's evaluators reach the cap. */
  async assertCreationAllowed(input: {
    projectId: string;
    operatorId?: string | undefined;
  }): Promise<void> {
    const organizationId = await this.deps.projects.getOrganizationId(input.projectId);
    const plan = await this.deps.plans.getActivePlan({
      organizationId,
      ...(input.operatorId ? { operator: { id: input.operatorId } } : {}),
    });
    const cap = planCreationCap({ plan, limitType: "evaluators" });
    if (!cap.capped) return;

    const projectIds = await this.deps.projects.listIdsByOrganization({ organizationId });
    const current = await this.deps.evaluators.countActiveByProjects({ projectIds });
    if (current >= cap.max) throw new LimitExceededError("evaluators", current, cap.max);
  }
}
