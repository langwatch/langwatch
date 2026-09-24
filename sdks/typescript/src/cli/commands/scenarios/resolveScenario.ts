import chalk from "chalk";

import type { ScenarioResponse, ScenariosApiService } from "@/client-sdk/services/scenarios";

import { createCliScenariosService } from "./cli-scenarios-service";

/**
 * A scenario reference that names nothing, or more than one thing; the
 * message carries the offered ids so the caller can fix it from that alone.
 */
export class ScenarioReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioReferenceError";
  }
}

/**
 * Finds the scenario a reference names: as an id first (one fetch), then an
 * exact name, then a name without case. A shared name is refused with both
 * ids. @see specs/features/scenario-cli.feature
 */
export async function resolveScenarioReference({
  reference,
  service,
}: {
  reference: string;
  service?: ScenariosApiService;
}): Promise<ScenarioResponse> {
  const scenariosService = service ?? createCliScenariosService();

  const direct = await scenariosService
    .get(reference)
    .then((found) => ({ found, error: undefined }))
    .catch((error: unknown) => ({ found: undefined, error }));
  if (direct.found) return direct.found;

  let scenarios: ScenarioResponse[];
  try {
    scenarios = await scenariosService.getAll();
  } catch (listingError) {
    // Neither read answered. The caller asked about one reference, so the
    // failure that names it is the one worth showing.
    throw direct.error ?? listingError;
  }

  const byId = scenarios.find((scenario) => scenario.id === reference);
  if (byId) return byId;

  const wanted = reference.trim();
  const exact = scenarios.filter((scenario) => scenario.name === wanted);
  const matches =
    exact.length > 0
      ? exact
      : scenarios.filter((scenario) => scenario.name.toLowerCase() === wanted.toLowerCase());

  if (matches.length === 1) return matches[0]!;

  if (matches.length > 1) {
    throw new ScenarioReferenceError(
      `More than one scenario is named "${reference}". Name it by ID instead: ${matches
        .map((scenario) => scenario.id)
        .join(", ")}`,
    );
  }

  throw new ScenarioReferenceError(
    `Scenario "${reference}" not found. List the scenarios with: langwatch scenario list`,
  );
}

/**
 * Finds the scenario a reference names, ending the command when it matches
 * nothing or more than one. A failure to read the list is left to the caller.
 */
export async function resolveScenarioOrExit({
  reference,
  service,
}: {
  reference: string;
  service?: ScenariosApiService;
}): Promise<ScenarioResponse> {
  try {
    return await resolveScenarioReference({ reference, service });
  } catch (error) {
    if (error instanceof ScenarioReferenceError) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
    throw error;
  }
}

/** The id of the scenario a reference names; see `resolveScenarioOrExit`. */
export async function resolveScenarioId({
  reference,
  service,
}: {
  reference: string;
  service?: ScenariosApiService;
}): Promise<string> {
  const scenario = await resolveScenarioOrExit({ reference, service });
  return scenario.id;
}
