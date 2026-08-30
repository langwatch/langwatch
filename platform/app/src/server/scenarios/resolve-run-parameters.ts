/**
 * Resolves the parameter values a run uses, and refuses the run when they
 * cannot produce a scenario the target and the judge can read.
 *
 * Every check happens here, before anything is scheduled: a run either starts
 * whole or is rejected whole. A batch that scheduled half its jobs and then
 * discovered a typo in a parameter name would leave the customer reading a
 * partially-executed run and guessing which half is real.
 *
 * Secret values are split out here too, before the first merge. What comes back
 * for a scenario is a pair: the plain values, which render its text and reach
 * the child as `params`, and the secret values, which reach the child as
 * `secrets` and are encrypted by the caller before anything is recorded.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 * @see specs/scenarios/secret-run-parameters.feature
 */

import {
  ScenarioParameterMissingError,
  ScenarioParameterOptionInvalidError,
  ScenarioParameterTemplateInvalidError,
  ScenarioParameterUnknownError,
  ScenarioSecretParameterConflictError,
  ScenarioSecretParameterInTextError,
  ScenarioSecretParameterMissingError,
} from "./errors";
import { renderScenarioContent } from "./execution/scenario-content-template";
import {
  findUnknownParameterKeys,
  mergeRunParameters,
  parseScenarioParameterDefinitions,
  partitionParameterDefinitions,
  type RunParameterValues,
  type ScenarioParameterDefinition,
  withoutParameterNames,
} from "./parameters";
import type { ScenarioRunConfig } from "./scenario.repository";

/**
 * What one scenario in the run resolved.
 *
 * The two records never overlap: a name is either plain or secret for the whole
 * run, which is what the conflict check below guarantees.
 */
export type ResolvedScenarioParameters = {
  /** Values the scenario text renders against and the child reads as `params`. */
  parameters: RunParameterValues;
  /** Values the child reads as `secrets`, in clear. The caller encrypts them. */
  secretParameters: Record<string, string>;
};

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
 * Refuses the run when a supplied value is outside the closed option list a
 * parameter declares.
 *
 * Checked on the supplied values alone: a default is one of the options by
 * construction, and a value the run never named cannot be wrong. The first
 * declaration of a name that lists options is the one that decides.
 */
function assertEveryValueIsAnOption({
  definitions,
  values,
}: {
  definitions: readonly ScenarioParameterDefinition[];
  values?: RunParameterValues;
}): void {
  if (!values) return;
  const optionsByName = new Map<
    string,
    ScenarioParameterDefinition["options"]
  >();
  for (const definition of definitions) {
    if (definition.options && !optionsByName.has(definition.name)) {
      optionsByName.set(definition.name, definition.options);
    }
  }
  for (const [name, value] of Object.entries(values)) {
    const options = optionsByName.get(name);
    if (!options || options.includes(value)) continue;
    throw new ScenarioParameterOptionInvalidError({ name, value, options });
  }
}

/**
 * Refuses the run when one name is secret in one scenario and plain in
 * another.
 *
 * The run supplies one value per name, so the pair cannot both be honoured:
 * the plain scenario would render a credential into its own text.
 */
function assertNoSecretConflict({
  secretNames,
  plainNames,
}: {
  secretNames: Set<string>;
  plainNames: Set<string>;
}): void {
  const conflicting = [...secretNames].filter((name) => plainNames.has(name));
  if (conflicting.length === 0) return;
  throw new ScenarioSecretParameterConflictError({ names: conflicting });
}

/**
 * Refuses the run when a declared secret has no text value for this run.
 *
 * A secret carries no default, so there is nothing to fall back to, and a
 * number or a boolean is not a credential. An empty string is refused with
 * them: the run dialog cannot send one, but a caller that goes straight to the
 * API can, and it would reach the target as a credential of no length.
 */
function assertEverySecretHasAValue({
  secretNames,
  values,
}: {
  secretNames: Set<string>;
  values?: RunParameterValues;
}): void {
  const missing = [...secretNames].filter((name) => {
    const value = values?.[name];
    return typeof value !== "string" || value.length === 0;
  });
  if (missing.length === 0) return;
  throw new ScenarioSecretParameterMissingError({ names: missing });
}

/**
 * Refuses the run when a scenario's own text cannot be rendered against the
 * values it resolved, naming which part of the scenario could not be.
 *
 * `declaredNames` still carries the secret names even though `parameters` does
 * not hold their values. That is what turns a `params.SECRET` reference into a
 * reported missing name here, which this then raises as the dedicated error
 * instead of asking the customer for a value that would be refused anyway.
 */
async function assertScenarioTextRenders({
  scenario,
  parameters,
  declaredNames,
  secretNames,
}: {
  scenario: ScenarioRunConfig;
  parameters: RunParameterValues;
  declaredNames: string[];
  secretNames: Set<string>;
}): Promise<void> {
  const rendered = await renderScenarioContent({
    situation: scenario.situation,
    criteria: scenario.criteria,
    parameters,
    declaredNames,
  });
  if (rendered.ok) return;
  if (rendered.reason === "missing_parameters") {
    const readSecrets = rendered.names.filter((name) => secretNames.has(name));
    if (readSecrets.length > 0) {
      throw new ScenarioSecretParameterInTextError({
        names: readSecrets,
        field: rendered.field,
      });
    }
    throw new ScenarioParameterMissingError({
      names: rendered.names,
      field: rendered.field,
    });
  }
  throw new ScenarioParameterTemplateInvalidError({ field: rendered.field });
}

/** The values this scenario's own secret declarations resolved. */
function secretValuesFor({
  definitions,
  values,
}: {
  definitions: readonly ScenarioParameterDefinition[];
  values?: RunParameterValues;
}): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const definition of definitions) {
    const value = values?.[definition.name];
    if (typeof value === "string") resolved[definition.name] = value;
  }
  return resolved;
}

/**
 * Merges the supplied values over each scenario's declared defaults, and takes
 * the secret ones out of that merge.
 *
 * @throws {ScenarioParameterUnknownError} when a supplied name is declared by
 *   no scenario in the run.
 * @throws {ScenarioSecretParameterConflictError} when one name is declared
 *   secret by one scenario in the run and plain by another.
 * @throws {ScenarioSecretParameterMissingError} when a declared secret has no
 *   text value for this run.
 * @throws {ScenarioSecretParameterInTextError} when a scenario's own text
 *   reads a secret parameter.
 * @throws {ScenarioParameterMissingError} when a scenario's own text reads a
 *   parameter the run resolved no value for.
 * @throws {ScenarioParameterTemplateInvalidError} when a scenario that
 *   declares parameters has text the template engine cannot render.
 */
export async function resolveRunParameters({
  scenarios,
  targetDefinitions = [],
  values,
}: {
  scenarios: readonly ScenarioRunConfig[];
  /**
   * The parameters the run's target declares on its own, a connected agent's
   * function parameters. Every scenario of the run reads them after its own
   * declarations, so a scenario's default wins over the agent's. They are
   * never secret: a secret stays scenario-declared and run-level.
   */
  targetDefinitions?: readonly ScenarioParameterDefinition[];
  values?: RunParameterValues;
}): Promise<Map<string, ResolvedScenarioParameters>> {
  const targetPlain = targetDefinitions.filter(
    (definition) => definition.secret !== true,
  );
  const definitionsByScenarioId = new Map(
    scenarios.map((scenario) => {
      const own = partitionParameterDefinitions(
        parseScenarioParameterDefinitions(scenario.parameters),
      );
      // The agent's definitions sit before the scenario's own, and a later
      // default overwrites an earlier one in the merge, so the scenario's
      // own default is the one the run reads.
      return [
        scenario.id,
        {
          plain: [...targetPlain, ...own.plain],
          secret: own.secret,
          own: [...own.plain, ...own.secret],
        },
      ];
    }),
  );

  const secretNames = new Set<string>();
  const plainNames = new Set<string>();
  const allDefinitions: ScenarioParameterDefinition[] = [];
  for (const { plain, secret, own } of definitionsByScenarioId.values()) {
    for (const definition of plain) plainNames.add(definition.name);
    for (const definition of secret) secretNames.add(definition.name);
    allDefinitions.push(...own);
  }
  for (const definition of targetPlain) plainNames.add(definition.name);
  const declaredNames = new Set([...plainNames, ...secretNames]);

  assertEveryNameIsDeclared({ declaredNames, values });
  assertEveryValueIsAnOption({
    definitions: [...allDefinitions, ...targetPlain],
    values,
  });
  assertNoSecretConflict({ secretNames, plainNames });
  assertEverySecretHasAValue({ secretNames, values });

  // The plain merge below never sees a secret value, so nothing downstream of
  // it, the scenario text included, can read one.
  const plainValues = withoutParameterNames({ values, names: secretNames });

  const resolved = new Map<string, ResolvedScenarioParameters>();
  for (const scenario of scenarios) {
    const { plain, secret } = definitionsByScenarioId.get(scenario.id) ?? {
      plain: [],
      secret: [],
    };
    const parameters = mergeRunParameters({
      definitions: plain,
      values: plainValues,
    });

    await assertScenarioTextRenders({
      scenario,
      parameters,
      declaredNames: [...plain, ...secret].map((definition) => definition.name),
      secretNames,
    });

    resolved.set(scenario.id, {
      parameters,
      secretParameters: secretValuesFor({ definitions: secret, values }),
    });
  }

  return resolved;
}
