import { LimitExceededError } from "@langwatch/enterprise-licensing-contract";
import { planCreationCap, type EntitlementApi } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScenarioEventType, simulationRunStartKey } from "@langwatch/scenario-contract";

import type { ScenarioRepository, TestSuiteCap } from "../repositories/scenario.repository.ts";

type TestSuiteCreationCap = { kind: "uncapped" } | { kind: "capped"; cap: TestSuiteCap };

type ScenarioCreationCapDependencies = Readonly<{
  plans: Pick<EntitlementApi, "getActivePlan" | "assertScenarioRunAllowed">;
  projects: Pick<ProjectApi, "getOrganizationId" | "listIdsByOrganization">;
  scenarios: Pick<ScenarioRepository, "countActiveByProjects">;
}>;

/**
 * The cloud Free caps on scenarios, template-made suites and scenario runs. Only creating one
 * more scenario or template suite, or starting a run past the month's cap, is refused.
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
    sourceTemplateId?: string | undefined;
  }): Promise<void> {
    if (input.sourceTemplateId) return;
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
   * A template's scenarios skip the scenario cap inside their own suite, so a template apply is
   * bounded twice: by the suite cap this returns for the locked write, and by counted scenarios.
   * @throws LimitExceededError (`scenarios`) when counted scenarios already exceed the cap.
   */
  async testSuiteCreationCap(input: {
    projectId: string;
    templateId?: string | undefined;
  }): Promise<TestSuiteCreationCap> {
    if (!input.templateId) return { kind: "uncapped" };
    const organizationId = await this.deps.projects.getOrganizationId(input.projectId);
    const plan = await this.deps.plans.getActivePlan({ organizationId });
    const suiteCap = planCreationCap({ plan, limitType: "scenarioSets" });
    const scenarioCap = planCreationCap({ plan, limitType: "scenarios" });
    if (!suiteCap.capped && !scenarioCap.capped) return { kind: "uncapped" };

    const projectIds = await this.deps.projects.listIdsByOrganization({ organizationId });
    if (scenarioCap.capped) {
      const scenarios = await this.deps.scenarios.countActiveByProjects({ projectIds });
      if (scenarios > scenarioCap.max) {
        throw new LimitExceededError("scenarios", scenarios, scenarioCap.max);
      }
    }
    if (!suiteCap.capped) return { kind: "uncapped" };
    return { kind: "capped", cap: { organizationId, projectIds, max: suiteCap.max } };
  }

  /**
   * Asks the entitlement run cap before a RUN_STARTED is accepted and counts the run once per
   * run id, so a retried start or one admitted at queue time is not counted again.
   * @throws LimitExceededError (`scenarioRuns`)
   */
  async assertRunStartAllowed(input: {
    projectId: string;
    event: { type: string; scenarioRunId: string };
  }): Promise<void> {
    if (input.event.type !== ScenarioEventType.RUN_STARTED) return;
    await this.#askRunCap({
      projectId: input.projectId,
      shouldCountRun: true,
      scenarioRunId: input.event.scenarioRunId,
    });
  }

  /**
   * Asks the run cap for a run whose start is written here, not reported (a voice call), and
   * counts it under its start key.
   * @throws LimitExceededError (`scenarioRuns`)
   */
  async assertCountedRunAllowed(input: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<void> {
    await this.#askRunCap({ ...input, shouldCountRun: true });
  }

  /**
   * Asks the run cap before a run is queued, so the caller that started it gets the refusal.
   * With the run id it also admits and counts the run, so its reported start is not refused.
   * Without one it only asks: the run is counted when its RUN_STARTED is reported.
   * @throws LimitExceededError (`scenarioRuns`)
   */
  async assertRunAllowed(input: { projectId: string; scenarioRunId?: string }): Promise<void> {
    await this.#askRunCap({
      projectId: input.projectId,
      shouldCountRun: input.scenarioRunId !== undefined,
      scenarioRunId: input.scenarioRunId,
    });
  }

  async #askRunCap(input: {
    projectId: string;
    shouldCountRun: boolean;
    scenarioRunId?: string | undefined;
  }): Promise<void> {
    const organizationId = await this.deps.projects.getOrganizationId(input.projectId);
    const { projectId, scenarioRunId } = input;
    await this.deps.plans.assertScenarioRunAllowed({
      organizationId,
      shouldCountRun: input.shouldCountRun,
      ...(scenarioRunId
        ? {
            runKey: {
              projectId,
              deduplicationKey: simulationRunStartKey({ projectId, scenarioRunId }),
            },
          }
        : {}),
    });
  }
}
