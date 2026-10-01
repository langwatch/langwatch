/**
 * The parameter overrides of a test run, as one line; the agent panel reads the
 * same line the Agent Testing run dialog does (specs/features/agent-testing/run-dialog.feature).
 */

import { serializeOptionalTypedScalarValue } from "@langwatch/design-system/json-value-text";
import type { RunParameterValues, ScenarioParameterDefinition } from "@langwatch/scenario-contract";

/** The declared type of each named parameter, for reading typed values. */
function parameterTypes(
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
 */
function parseParameterLine(line: string): [string, string][] {
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
 * What the run sends: the line, plus whatever was typed into the secret fields.
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
