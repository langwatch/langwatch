import { LimitExceededError } from "@langwatch/enterprise-licensing-contract";
import { planCreationCap, type EntitlementApi } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScenarioEventType } from "@langwatch/scenario-contract";

import type { ScenarioRepository } from "../repositories/scenario.repository.ts";
import { isCountedScenarioSet } from "../rules/scenario-set-cap.rules.ts";

type ScenarioCreationCapDependencies = Readonly<{
  plans: Pick<EntitlementApi, "getActivePlan" | "assertScenarioRunAllowed">;
  projects: Pick<ProjectApi, "getOrganizationId" | "listIdsByOrganization">;
  scenarios: Pick<ScenarioRepository, "countActiveByProjects">;
}>;

/**
 * The cloud Free caps on scenarios and on scenario runs. Only creating one more
 * scenario, or starting a run past the month's cap, is refused.
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
export class ScenarioCreationCapService {
  static create(deps: ScenarioCreationCapDependencies): ScenarioCreationCapService {
    return new ScenarioCreationCapService(deps);
  }

  private constructor(private readonly deps: ScenarioCreationCapDependencies) {}

  /** @throws LimitExceededError (`scenarios`) once the organization's scenarios reach the cap. */
  async assertScenarioCreationAllowed(input: {
    projectId: string;
    operatorId?: string | undefined;
  }): Promise<void> {
    const organizationId = await this.deps.projects.getOrganizationId(input.projectId);
    const plan = await this.deps.plans.getActivePlan({
      organizationId,
      ...(input.operatorId ? { operator: { id: input.operatorId } } : {}),
    });
    const cap = planCreationCap({ plan, limitType: "scenarios" });
    if (!cap.capped) return;

    const projectIds = await this.deps.projects.listIdsByOrganization({ organizationId });
    const current = await this.deps.scenarios.countActiveByProjects({ projectIds });
    if (current >= cap.max) throw new LimitExceededError("scenarios", current, cap.max);
  }

  /**
   * Asks the entitlement run cap before a RUN_STARTED is accepted. Platform-owned
   * sets are never capped; an unknown run count lets the run through.
   * @throws LimitExceededError (`scenarioRuns`)
   */
  async assertRunStartAllowed(input: {
    projectId: string;
    event: { type: string; scenarioSetId?: string | undefined };
  }): Promise<void> {
    if (input.event.type !== ScenarioEventType.RUN_STARTED) return;
    const scenarioSetId = input.event.scenarioSetId;
    if (scenarioSetId && !isCountedScenarioSet(scenarioSetId)) return;

    const organizationId = await this.deps.projects.getOrganizationId(input.projectId);
    await this.deps.plans.assertScenarioRunAllowed({ organizationId });
  }
}
