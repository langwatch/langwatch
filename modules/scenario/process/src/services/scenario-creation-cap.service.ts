import { LimitExceededError } from "@langwatch/enterprise-licensing-contract";
import { planCreationCap, type EntitlementApi } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScenarioEventType } from "@langwatch/scenario-contract";

import type { ScenarioRepository } from "../repositories/scenario.repository.ts";

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
   * Asks the entitlement run cap before a RUN_STARTED is accepted and counts the run. Every
   * run start counts, whichever set it belongs to; an unknown run count lets the run through.
   * @throws LimitExceededError (`scenarioRuns`)
   */
  async assertRunStartAllowed(input: {
    projectId: string;
    event: { type: string };
  }): Promise<void> {
    if (input.event.type !== ScenarioEventType.RUN_STARTED) return;
    await this.assertCountedRunAllowed({ projectId: input.projectId });
  }

  /**
   * Asks the run cap for a run whose start is written here, not reported (a voice call), and
   * counts it.
   * @throws LimitExceededError (`scenarioRuns`)
   */
  async assertCountedRunAllowed(input: { projectId: string }): Promise<void> {
    await this.#askRunCap({ projectId: input.projectId, shouldCountRun: true });
  }

  /**
   * Asks the run cap before a run is queued, so the caller that started it gets the refusal.
   * Only asks: the run is counted once, when its RUN_STARTED is reported.
   * @throws LimitExceededError (`scenarioRuns`)
   */
  async assertRunAllowed(input: { projectId: string }): Promise<void> {
    await this.#askRunCap({ projectId: input.projectId, shouldCountRun: false });
  }

  async #askRunCap(input: { projectId: string; shouldCountRun: boolean }): Promise<void> {
    const organizationId = await this.deps.projects.getOrganizationId(input.projectId);
    await this.deps.plans.assertScenarioRunAllowed({
      organizationId,
      shouldCountRun: input.shouldCountRun,
    });
  }
}
