/** Resolves run parameters upfront; splits secrets before first merge. Fails
 * whole if any parameter invalid, not partially.
 */

import { renderScenarioContent } from "./scenario-content-template.ts";
import {
  ScenarioParameterMissingError,
  ScenarioParameterOptionInvalidError,
  ScenarioParameterRequiredError,
  ScenarioParameterTemplateInvalidError,
  ScenarioParameterUnknownError,
  ScenarioSecretParameterConflictError,
  ScenarioSecretParameterInTextError,
  ScenarioSecretParameterMissingError,
} from "./scenario-run-parameter.error.ts";
import {
  findUnknownParameterKeys,
  mergeRunParameters,
  parseScenarioParameterDefinitions,
  partitionParameterDefinitions,
  type RunParameterValues,
  type ScenarioParameterDefinition,
  withoutParameterNames,
} from "./scenario.parameters.ts";
import type { ScenarioRunConfig } from "./scenario.ts";

/**
 * What one scenario in the run resolved. The two records never overlap: a
 * name is either plain or secret for the whole run, which is what the
 * conflict check below guarantees.
 */
export type ResolvedScenarioParameters = {
  /** Values the scenario text renders against and the child reads as `params`. */
  parameters: RunParameterValues;
  /** Values the child reads as `secrets`, in clear. The caller encrypts them. */
  secretParameters: Record<string, string>;
};

/** Refuses run when caller names parameter nothing declares; likely typo that
 * would silently pass with unseen values.
 */
function assertEveryNameIsDeclared({
  declaredNames,
  values,
  targetLabel,
}: {
  declaredNames: Set<string>;
  values?: RunParameterValues;
  /** The target this set of values was resolved for, when the run names one. */
  targetLabel?: string;
}): void {
  if (!values) return;
  const unknownKeys = findUnknownParameterKeys({ declaredNames, values });
  if (unknownKeys.length === 0) return;
  throw new ScenarioParameterUnknownError({
    unknownKeys,
    declaredNames: [...declaredNames],
    ...(targetLabel ? { targetLabel } : {}),
  });
}

/** Refuses run when supplied value violates closed option list; checks only
 * supplied values, not defaults.
 */
function assertEveryValueIsAnOption({
  definitions,
  values,
}: {
  definitions: readonly ScenarioParameterDefinition[];
  values?: RunParameterValues;
}): void {
  if (!values) return;
  const optionsByName = new Map<string, ScenarioParameterDefinition["options"]>();
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
 * Refuses the run when a required parameter resolved no value. A connected
 * agent requires every function parameter with no code default. Read on
 * merged values so a scenario default can answer the requirement.
 */
function assertEveryRequiredHasAValue({
  definitions,
  parameters,
}: {
  definitions: readonly ScenarioParameterDefinition[];
  parameters: RunParameterValues;
}): void {
  const required = new Set(
    definitions
      .filter((definition) => definition.required === true)
      .map((definition) => definition.name),
  );
  const missing = [...required].filter((name) => parameters[name] === undefined);
  if (missing.length === 0) return;
  throw new ScenarioParameterRequiredError({ names: missing });
}

/**
 * Refuses the run when one name is secret in one scenario and plain in
 * another. The run supplies one value per name, so honouring both would
 * render a credential into the plain scenario's own text.
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
 * Refuses the run when a declared secret has no text value; secrets have no
 * default to fall back to. An empty string is refused too — the dialog
 * can't send one, but a direct API caller can, as a zero-length credential.
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

/** Refuses run when scenario text cannot render against resolved values;
 * catches secrets referenced in text as dedicated error.
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

/** Merges supplied values over declared defaults, separates secrets, and
 * validates all parameters for each scenario.
 */
export async function resolveRunParameters({
  scenarios,
  targetDefinitions = [],
  targetLabel,
  values,
}: {
  scenarios: readonly ScenarioRunConfig[];
  /**
   * The parameters the run's target declares on its own, a connected
   * agent's function parameters. Read after each scenario's own declarations,
   * so a scenario default wins. Never secret; secrets stay scenario-level.
   */
  targetDefinitions?: readonly ScenarioParameterDefinition[];
  /** What the target is called, for a refusal that names it. */
  targetLabel?: string;
  values?: RunParameterValues;
}): Promise<Map<string, ResolvedScenarioParameters>> {
  const targetPlain = targetDefinitions.filter((definition) => definition.secret !== true);
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

  assertEveryNameIsDeclared({ declaredNames, values, targetLabel });
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

    assertEveryRequiredHasAValue({ definitions: plain, parameters });

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
