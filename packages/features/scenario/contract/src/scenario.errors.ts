export class ScenarioNotFoundError extends Error {
  readonly code = "scenario_not_found" as const;

  constructor(readonly scenarioId: string) {
    super(`Scenario ${scenarioId} was not found.`);
    this.name = "ScenarioNotFoundError";
  }
}
