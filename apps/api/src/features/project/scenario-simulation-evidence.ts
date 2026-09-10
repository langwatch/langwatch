/**
 * Whether a project has run any simulation, off the process's own simulation reads.
 *
 * The checklist step is an evidence question, not a listing: one scenario set is enough, so
 * the read stops at "is there one". `platform/app` asked it the same way and swallowed a
 * ClickHouse failure into "not started"; the swallow lives in the checklist itself, which is
 * where the step's copy is written.
 */
import type { SimulationService } from "@langwatch/scenario-contract";
import { ApiSimulationEvidence } from "./integrations-checks.composition.ts";

export class ApiScenarioSimulationEvidence extends ApiSimulationEvidence {
  static create(
    simulations: Pick<SimulationService, "getScenarioSetsData">,
  ): ApiScenarioSimulationEvidence {
    return new ApiScenarioSimulationEvidence(simulations);
  }

  private constructor(
    private readonly simulations: Pick<SimulationService, "getScenarioSetsData">,
  ) {
    super();
  }

  async hasAnySimulation(input: { projectId: string }): Promise<boolean> {
    const sets = await this.simulations.getScenarioSetsData({ projectId: input.projectId });
    return sets.length > 0;
  }
}
