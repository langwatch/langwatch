import { HandledError } from "@langwatch/handled-error";

export class ScenarioNotFoundError extends Error {
  readonly code = "scenario_not_found" as const;

  constructor(readonly scenarioId: string) {
    super(`Scenario ${scenarioId} was not found.`);
    this.name = "ScenarioNotFoundError";
  }
}

export class ScenarioFolderNotFoundError extends HandledError {
  declare readonly code: "scenario_folder_not_found";

  constructor() {
    super("scenario_folder_not_found", "Test suite folder not found", { httpStatus: 404 });
    this.name = "ScenarioFolderNotFoundError";
  }
}

export class ScenarioFolderSlugUnavailableError extends Error {
  readonly code = "scenario_folder_slug_unavailable" as const;

  constructor() {
    super("Could not allocate a unique scenario folder slug.");
    this.name = "ScenarioFolderSlugUnavailableError";
  }
}
