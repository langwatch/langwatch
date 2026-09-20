import chalk from "chalk";
import type {
  ScenarioResponse,
  ScenariosApiService,
} from "@/client-sdk/services/scenarios";
import { createCliScenariosService } from "./cli-scenarios-service";

/**
 * A scenario reference that names nothing, or more than one thing.
 *
 * Both readings are refusals the caller can fix from the message alone, so
 * they carry the offered ids rather than a generic failure.
 */
export class ScenarioReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioReferenceError";
  }
}

/**
 * Finds the scenario a reference names.
 *
 * An id is tried first, then an exact name, then a name compared without
 * case. A name two scenarios share is refused with both ids, because picking
 * one for the caller would act on a scenario they did not ask for. The same
 * reading `test-suite` commands give a suite reference.
 *
 * @see specs/features/scenario-cli.feature
 */
export async function resolveScenarioReference({
  reference,
  service,
}: {
  reference: string;
  service?: ScenariosApiService;
}): Promise<ScenarioResponse> {
  const scenariosService = service ?? createCliScenariosService();
  const scenarios = await scenariosService.getAll();

  const byId = scenarios.find((scenario) => scenario.id === reference);
  if (byId) return byId;

  const wanted = reference.trim();
  const exact = scenarios.filter((scenario) => scenario.name === wanted);
  const matches =
    exact.length > 0
      ? exact
      : scenarios.filter(
          (scenario) => scenario.name.toLowerCase() === wanted.toLowerCase(),
        );

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
 * Finds the scenario a reference names, ending the command when the name
 * matches nothing or more than one scenario. Kept here rather than in a
 * command module so every command that takes a scenario reference refuses
 * it the same way. A failure to read the list is not a refusal and is left
 * to the caller.
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
