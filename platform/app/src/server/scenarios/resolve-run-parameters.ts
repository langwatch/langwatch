/**
 * Resolves the parameter values a run uses, and refuses the run when they
 * cannot produce a scenario the target and the judge can read.
 *
 * Every check happens here, before anything is scheduled: a run either starts
 * whole or is rejected whole. A batch that scheduled half its jobs and then
 * discovered a typo in a parameter name would leave the customer reading a
 * partially-executed run and guessing which half is real.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 */

import {
  ScenarioParameterMissingError,
  ScenarioParameterTemplateInvalidError,
  ScenarioParameterUnknownError,
} from "./errors";
import { renderScenarioContent } from "./execution/scenario-content-template";
import {
  findUnknownParameterKeys,
  mergeRunParameters,
  parseScenarioParameterDefinitions,
  type RunParameterValues,
} from "./parameters";
import type { ScenarioRunConfig } from "./scenario.repository";

/**
 * Refuses the run when the caller named something no scenario in it declares.
 *
 * A name the run cannot act on is almost always a typo, and a run that
 * silently ignored it would report a pass for values the target never saw.
 */
function assertEveryNameIsDeclared({
  declaredNames,
  values,
}: {
  declaredNames: Set<string>;
  values?: RunParameterValues;
}): void {
  if (!values) return;
  const unknownKeys = findUnknownParameterKeys({ declaredNames, values });
  if (unknownKeys.length === 0) return;
  throw new ScenarioParameterUnknownError({
    unknownKeys,
    declaredNames: [...declaredNames],
  });
}

/**
 * Refuses the run when a scenario's own text cannot be rendered against the
 * values it resolved, naming which part of the scenario could not be.
 */
async function assertScenarioTextRenders({
  scenario,
  parameters,
  declaredNames,
}: {
  scenario: ScenarioRunConfig;
  parameters: RunParameterValues;
  declaredNames: string[];
}): Promise<void> {
  const rendered = await renderScenarioContent({
    situation: scenario.situation,
    criteria: scenario.criteria,
    parameters,
    declaredNames,
  });
  if (rendered.ok) return;
  if (rendered.reason === "missing_parameters") {
    throw new ScenarioParameterMissingError({
      names: rendered.names,
      field: rendered.field,
    });
  }
  throw new ScenarioParameterTemplateInvalidError({ field: rendered.field });
}

/**
 * Merges the supplied values over each scenario's declared defaults.
 *
 * @throws {ScenarioParameterUnknownError} when a supplied name is declared by
 *   no scenario in the run.
 * @throws {ScenarioParameterMissingError} when a scenario's own text reads a
 *   parameter the run resolved no value for.
 * @throws {ScenarioParameterTemplateInvalidError} when a scenario that
 *   declares parameters has text the template engine cannot render.
 */
export async function resolveRunParameters({
  scenarios,
  values,
}: {
  scenarios: readonly ScenarioRunConfig[];
  values?: RunParameterValues;
}): Promise<Map<string, RunParameterValues>> {
  const definitionsByScenarioId = new Map(
    scenarios.map((scenario) => [
      scenario.id,
      parseScenarioParameterDefinitions(scenario.parameters),
    ]),
  );

  const declaredNames = new Set(
    [...definitionsByScenarioId.values()].flatMap((definitions) =>
      definitions.map((definition) => definition.name),
    ),
  );

  assertEveryNameIsDeclared({ declaredNames, values });

  const resolved = new Map<string, RunParameterValues>();
  for (const scenario of scenarios) {
    const definitions = definitionsByScenarioId.get(scenario.id) ?? [];
    const parameters = mergeRunParameters({ definitions, values });

    await assertScenarioTextRenders({
      scenario,
      parameters,
      declaredNames: definitions.map((definition) => definition.name),
    });

    resolved.set(scenario.id, parameters);
  }

  return resolved;
}
