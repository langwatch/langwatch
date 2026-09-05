/**
 * The parameter names a run carries that nothing in it declares.
 * @see specs/features/agent-testing/run-dialog.feature
 */

import type { DeclaredParameter } from "../../../../behavior/suites/use-run-suite";
import { parseParameterLine } from "../../../../model/agent-testing/run/parameter-line";
import type { ParameterRow } from "../../../../model/agent-testing/run/parameter-rows";

/** The names of every declaration in scope, secrets included. */
function namesOf(definitions: readonly DeclaredParameter[]): Set<string> {
  return new Set(definitions.map((definition) => definition.name));
}

/** The names a line holds that nothing in the run declares, without repeats. */
export function undeclaredNamesOnLine({
  line,
  definitions,
}: {
  line: string;
  definitions: readonly DeclaredParameter[];
}): string[] {
  const declared = namesOf(definitions);
  const found = parseParameterLine(line)
    .map(([name]) => name)
    .filter((name) => !declared.has(name));
  return [...new Set(found)];
}

/**
 * The names the plain rows hold that nothing in the run declares.
 */
export function undeclaredNamesOnRows({
  rows,
  definitions,
}: {
  rows: readonly ParameterRow[];
  definitions: readonly DeclaredParameter[];
}): string[] {
  const declared = namesOf(definitions);
  const found = rows
    .filter((row) => row.secret !== true)
    .map((row) => row.name.trim())
    .filter((name) => name !== "" && !declared.has(name));
  return [...new Set(found)];
}

/**
 * The line without the pairs nothing in the run declares.
 */
export function lineWithoutUndeclared({
  line,
  definitions,
}: {
  line: string;
  definitions: readonly DeclaredParameter[];
}): string {
  const declared = namesOf(definitions);
  return parseParameterLine(line)
    .filter(([name]) => declared.has(name))
    .map(([name, raw]) => `${name}=${raw}`)
    .join(", ");
}

/** What the person reads under the field, and in the foot of the dialog. */
export function undeclaredParameterMessage({
  names,
  targetLabel,
}: {
  names: readonly string[];
  /** The agent the run goes against, when one is chosen. */
  targetLabel: string | null;
}): string {
  const subject =
    names.length === 1 ? `${names[0]} is not declared` : `${names.join(", ")} are not declared`;
  const source = targetLabel
    ? `by any scenario in this run, and not by ${targetLabel}`
    : "by any scenario in this run";
  return `${subject} ${source}. Remove it, or declare it on the scenario or on the agent.`;
}
