import { HandledError, NotFoundError } from "@langwatch/handled-error";

export class ScenarioNotFoundError extends HandledError {
  declare readonly code: "scenario_not_found";

  constructor(readonly scenarioId: string) {
    super("scenario_not_found", `Scenario ${scenarioId} was not found.`, {
      httpStatus: 404,
      fault: "customer",
      meta: { scenarioId },
    });
    this.name = "ScenarioNotFoundError";
  }
}

export class ScenarioFolderNotFoundError extends HandledError {
  declare readonly code: "scenario_folder_not_found";

  constructor(folderId?: string) {
    super("scenario_folder_not_found", "Test suite folder not found", {
      httpStatus: 404,
      fault: "customer",
      meta: { folderId: folderId ?? null },
    });
    this.name = "ScenarioFolderNotFoundError";
  }
}

export class ScenarioFolderSlugUnavailableError extends HandledError {
  declare readonly code: "scenario_folder_slug_unavailable";

  constructor(folderName: string) {
    super("scenario_folder_slug_unavailable", "Could not allocate a unique scenario folder slug.", {
      httpStatus: 409,
      fault: "customer",
      meta: { folderName },
    });
    this.name = "ScenarioFolderSlugUnavailableError";
  }
}

export class ScenarioStaleVersionError extends HandledError {
  declare readonly code: "scenario_stale_version";

  constructor(currentVersion: number) {
    super("scenario_stale_version", "This test case changed since it was loaded", {
      httpStatus: 409,
      fault: "customer",
      meta: { currentVersion },
    });
    this.name = "ScenarioStaleVersionError";
  }
}

export class ScenarioVersionNotFoundError extends NotFoundError {
  declare readonly code: "scenario_version_not_found";

  constructor(scenarioId: string, version: number) {
    super("scenario_version_not_found", "Scenario version", String(version), {
      meta: { scenarioId, version },
    });
    this.name = "ScenarioVersionNotFoundError";
  }
}
