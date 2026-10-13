import { LimitExceededError } from "@langwatch/enterprise-licensing-contract";
import { planCreationCap, type EntitlementApi } from "@langwatch/entitlement-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScenarioEventType, type SimulationService } from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";

import type { ScenarioRepository } from "../repositories/scenario.repository.ts";
import { isCountedScenarioSet } from "../rules/scenario-set-cap.rules.ts";

const logger = createLogger("langwatch:scenario:creation-cap");

/** Main's 30-second usage window for the known scenario sets. */
const SCENARIO_SET_CACHE_TTL_MS = 30_000;

type ScenarioCreationCapDependencies = Readonly<{
  plans: Pick<EntitlementApi, "getActivePlan">;
  projects: Pick<ProjectApi, "getOrganizationId" | "listIdsByOrganization">;
  scenarios: Pick<ScenarioRepository, "countActiveByProjects">;
  simulations: Pick<SimulationService, "getDistinctExternalSetIds">;
}>;

/**
 * The cloud Free caps on scenarios and simulations (distinct scenario sets).
 * Only creating one more is refused; plans that set no cap never count.
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
export class ScenarioCreationCapService {
  static create(deps: ScenarioCreationCapDependencies): ScenarioCreationCapService {
    return new ScenarioCreationCapService(deps);
  }

  readonly #knownSets = new Map<string, { setIds: string[]; expiresAt: number }>();

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
   * Refuses a RUN_STARTED that would start a new simulation past the cap. Sets
   * the organization already ran keep running, and an unknown count lets the run through.
   * @throws LimitExceededError (`scenarioSets`)
   */
  async assertRunStartAllowed(input: {
    projectId: string;
    event: { type: string; scenarioSetId?: string | undefined };
  }): Promise<void> {
    if (input.event.type !== ScenarioEventType.RUN_STARTED) return;
    const scenarioSetId = input.event.scenarioSetId;
    if (!scenarioSetId || !isCountedScenarioSet(scenarioSetId)) return;

    const organizationId = await this.deps.projects.getOrganizationId(input.projectId);
    const plan = await this.deps.plans.getActivePlan({ organizationId });
    const cap = planCreationCap({ plan, limitType: "scenarioSets" });
    if (!cap.capped) return;

    let knownSetIds: string[];
    try {
      knownSetIds = await this.#knownScenarioSetIds(organizationId);
    } catch (error) {
      logger.warn(
        { error, organizationId, plan: plan.name },
        "scenario set usage is unavailable, allowing the run",
      );
      return;
    }
    if (knownSetIds.includes(scenarioSetId)) return;
    if (knownSetIds.length >= cap.max) {
      throw new LimitExceededError("scenarioSets", knownSetIds.length, cap.max);
    }

    // Run events reach ClickHouse asynchronously, so the new set is remembered
    // at once or a burst of new sets could slip past the cap.
    this.#remember(organizationId, [...knownSetIds, scenarioSetId]);
  }

  async #knownScenarioSetIds(organizationId: string): Promise<string[]> {
    const cached = this.#knownSets.get(organizationId);
    if (cached && cached.expiresAt > nowInstant().epochMilliseconds) return cached.setIds;

    const projectIds = await this.deps.projects.listIdsByOrganization({ organizationId });
    const known =
      projectIds.length > 0
        ? [...(await this.deps.simulations.getDistinctExternalSetIds({ projectIds }))]
        : [];
    this.#remember(organizationId, known);
    return known;
  }

  #remember(organizationId: string, setIds: string[]): void {
    this.#knownSets.set(organizationId, {
      setIds,
      expiresAt: nowInstant().epochMilliseconds + SCENARIO_SET_CACHE_TTL_MS,
    });
  }
}
