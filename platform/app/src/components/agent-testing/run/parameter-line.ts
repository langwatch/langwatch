/**
 * The parameter overrides of a run, as one line.
 *
 * The line reads `name=value, name=value`. It is what a person writes fastest
 * when they only want to change one value, and it is what the run dialog
 * offers. A secret cannot ride on it, because the line shows what it holds, so
 * secrets keep their own masked field.
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
  serializeOptionalScalarValue,
  serializeScalarValue,
} from "~/utils/jsonValueText";

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

/** The line a set of declared parameters starts on: every default, in order. */
export function formatParameterLine(
  definitions: ScenarioParameterDefinition[],
): string {
  return definitions
    .filter((definition) => definition.secret !== true)
    .map(
      (definition) =>
        `${definition.name}=${displayOptionalValue(definition.defaultValue)}`,
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
 * default each case declares for it.
 */
export function toLineRunParameters({
  line,
  secretValues,
}: {
  line: string;
  /** The value typed for each secret parameter, keyed by name. */
  secretValues: Record<string, string>;
}): RunParameterValues | undefined {
  const parameters: RunParameterValues = {};

  for (const [name, raw] of parseParameterLine(line)) {
    const value = serializeOptionalScalarValue(raw);
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
  const described = new Map(
    existing.map((definition) => [definition.name, definition.description]),
  );

  const declared: ScenarioParameterDefinition[] = [];
  for (const [name, raw] of parseParameterLine(line)) {
    if (secrets.some((definition) => definition.name === name)) continue;
    const description = described.get(name);
    declared.push({
      name,
      ...(description ? { description } : {}),
      ...(raw === "" ? {} : { defaultValue: serializeScalarValue(raw) }),
    });
  }

  return [...declared, ...secrets];
}
