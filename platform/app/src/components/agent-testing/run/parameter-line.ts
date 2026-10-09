/**
 * The parameter overrides of a run, as one line.
 *
 * The line reads `name=value, name=value`. It is what a person writes fastest
 * when they only want to change one value, and it is what the run dialog
 * offers first. A secret cannot ride on it, because the line shows what it
 * holds, so a block with a secret in it turns into rows instead
 * (`parameter-rows.ts`).
 *
 * Everything here is pure, so the line rules can be read and tested on their
 * own.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import type {
  RunParameterValues,
  ScenarioParameterDefinition,
} from "~/server/scenarios/parameters";
import {
  displayOptionalValue,
  displayTypedValue,
  serializeOptionalTypedScalarValue,
  serializeScalarValue,
} from "~/utils/jsonValueText";

/** The declared type of each named parameter, for reading typed values. */
export function parameterTypes(
  definitions: readonly ScenarioParameterDefinition[] | undefined,
): Map<string, ScenarioParameterDefinition["type"]> {
  return new Map(
    (definitions ?? [])
      .filter((definition) => definition.type !== undefined)
      .map((definition) => [definition.name, definition.type]),
  );
}

/**
 * The pairs a line holds, in the order they were written.
 *
 * A pair is split on its first "=", so a value may hold one. A fragment with
 * no "=" and a pair with an empty name are dropped: there is nothing to send
 * them under.
 */
export function parseParameterLine(line: string): [string, string][] {
  const pairs: [string, string][] = [];
  for (const fragment of line.split(",")) {
    const separator = fragment.indexOf("=");
    if (separator === -1) continue;
    const name = fragment.slice(0, separator).trim();
    if (!name) continue;
    pairs.push([name, fragment.slice(separator + 1).trim()]);
  }
  return pairs;
}

/**
 * The line a set of remembered values reads as.
 *
 * The values come back from the suite the run was started on, so the dialog
 * opens on the overrides the last run used rather than on the declared
 * defaults.
 */
export function formatStoredParameterLine(values: RunParameterValues): string {
  return Object.entries(values)
    .map(([name, value]) => `${name}=${displayOptionalValue(value)}`)
    .join(", ");
}

/** The line a set of declared parameters starts on: every default, in order. */
export function formatParameterLine(
  definitions: readonly ScenarioParameterDefinition[],
): string {
  return definitions
    .filter((definition) => definition.secret !== true)
    .map(
      (definition) =>
        `${definition.name}=${displayTypedValue({
          value: definition.defaultValue,
          type: definition.type,
        })}`,
    )
    .join(", ");
}

/**
 * What the run sends: the line, plus whatever was typed into the secret
 * fields.
 *
 * A name is sent as it was written, declared or not, so a name no case
 * declares is refused by the server by name rather than dropped in silence.
 * A name left with an empty value is omitted, so the run falls back to the
 * default each case declares for it. A value is read as the type its
 * declaration names, so "007" stays text for a string parameter.
 */
export function toLineRunParameters({
  line,
  secretValues,
  definitions,
}: {
  line: string;
  /** The value typed for each secret parameter, keyed by name. */
  secretValues: Record<string, string>;
  /** The declarations in scope, for the type each value is read as. */
  definitions?: readonly ScenarioParameterDefinition[];
}): RunParameterValues | undefined {
  const parameters: RunParameterValues = {};
  const types = parameterTypes(definitions);

  for (const [name, raw] of parseParameterLine(line)) {
    const value = serializeOptionalTypedScalarValue({
      raw,
      type: types.get(name),
    });
    if (value === undefined) continue;
    parameters[name] = value;
  }

  // A secret keeps whatever was typed as text: a token of digits is still a
  // token, and the run refuses a secret that is not a string.
  for (const [name, typed] of Object.entries(secretValues)) {
    if (typed !== "") parameters[name] = typed;
  }

  return Object.keys(parameters).length > 0 ? parameters : undefined;
}

/**
 * The declarations a line stands for, keeping every secret the case already
 * declares.
 *
 * A secret carries no default and never rides on the line, so it would be
 * dropped by a save that read the line alone. Every other declaration is
 * rewritten from the line, so removing a pair removes the parameter.
 */
export function toParameterDefinitions({
  line,
  existing,
}: {
  line: string;
  /** What the case declares today, for the secrets and the descriptions. */
  existing: ScenarioParameterDefinition[];
}): ScenarioParameterDefinition[] {
  const secrets = existing.filter((definition) => definition.secret === true);
  const secretNames = new Set(secrets.map((definition) => definition.name));
  const known = new Map(
    existing.map((definition) => [definition.name, definition]),
  );

  const declared = parseParameterLine(line)
    .filter(([name]) => !secretNames.has(name))
    .map(([name, raw]) => declarationOf({ name, raw, known: known.get(name) }));

  return [...declared, ...secrets];
}

/**
 * One declaration read off the line. The line carries the name and the
 * default alone; what else the case already said about the name, its
 * description, type and options, stays.
 */
function declarationOf({
  name,
  raw,
  known,
}: {
  name: string;
  raw: string;
  known: ScenarioParameterDefinition | undefined;
}): ScenarioParameterDefinition {
  const { description, type, options } = known ?? {};
  const defaultValue =
    raw === ""
      ? undefined
      : type
        ? serializeOptionalTypedScalarValue({ raw, type })
        : serializeScalarValue(raw);
  return {
    name,
    ...(description ? { description } : {}),
    ...(type ? { type } : {}),
    ...(options ? { options } : {}),
    ...(defaultValue === undefined ? {} : { defaultValue }),
  };
}
