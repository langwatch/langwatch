/**
 * The parameter overrides of a run, as rows.
 * @see specs/features/agent-testing/run-dialog.feature
 */

import type { RunParameterValues, ScenarioParameterDefinition } from "@langwatch/scenario-contract";
import { serializeOptionalTypedScalarValue } from "@langwatch/design-system/json-value-text";
import { parameterTypes, parseParameterLine } from "./parameter-line";

/** One parameter of the block, as the rows editor holds it. */
export type ParameterRow = {
  name: string;
  value: string;
  /** Whether the value is hidden while typed and kept out of everything stored. */
  secret: boolean;
};

/** The rows a line stands for, in the order the line wrote them. */
export function rowsFromLine(line: string): ParameterRow[] {
  return parseParameterLine(line).map(([name, value]) => ({
    name,
    value,
    secret: false,
  }));
}

/**
 * The line a set of rows reads as.
 */
export function lineFromRows(rows: ParameterRow[]): string {
  return rows
    .filter((row) => !row.secret && row.name.trim() !== "")
    .map((row) => `${row.name.trim()}=${row.value.trim()}`)
    .join(", ");
}

/** Whether the block can go back to the single line it started on. */
export function canCollapseRows(rows: ParameterRow[]): boolean {
  return !rows.some((row) => row.secret);
}

/** The named rows, keyed once so a repeated key keeps its last value. */
function namedRows(rows: ParameterRow[]): ParameterRow[] {
  return rows.map((row) => ({ ...row, name: row.name.trim() })).filter((row) => row.name !== "");
}

/**
 * What the run sends: every named row, plus whatever was typed for the secrets the
 * scenarios declare.
 */
export function toRowsRunParameters({
  rows,
  secretValues,
  definitions,
}: {
  rows: ParameterRow[];
  /** The value typed for each declared secret parameter, keyed by name. */
  secretValues: Record<string, string>;
  /** The declarations in scope, for the type each value is read as. */
  definitions?: readonly ScenarioParameterDefinition[];
}): RunParameterValues | undefined {
  const parameters: RunParameterValues = {};
  const types = parameterTypes(definitions);

  for (const row of namedRows(rows)) {
    const value = rowValueOf(row, types.get(row.name));
    if (value !== undefined) parameters[row.name] = value;
  }

  for (const [name, typed] of Object.entries(secretValues)) {
    if (typed !== "") parameters[name] = typed;
  }

  return Object.keys(parameters).length > 0 ? parameters : undefined;
}

/** What a row sends, or nothing when it was left empty. */
function rowValueOf(row: ParameterRow, type: ScenarioParameterDefinition["type"]) {
  if (!row.secret) {
    return serializeOptionalTypedScalarValue({ raw: row.value, type });
  }
  return row.value === "" ? undefined : row.value;
}

/**
 * What the suite is allowed to remember: the plain rows and their values.
 */
export function toStorableRowParameters({
  rows,
  definitions,
}: {
  rows: ParameterRow[];
  /** The declarations in scope, for the type each value is read as. */
  definitions?: readonly ScenarioParameterDefinition[];
}): RunParameterValues | undefined {
  const parameters: RunParameterValues = {};
  const types = parameterTypes(definitions);
  for (const row of namedRows(rows)) {
    if (row.secret) continue;
    const value = serializeOptionalTypedScalarValue({
      raw: row.value,
      type: types.get(row.name),
    });
    if (value === undefined) continue;
    parameters[row.name] = value;
  }
  return Object.keys(parameters).length > 0 ? parameters : undefined;
}

/**
 * The keys of the secret rows, which is all a suite may remember of them.
 */
export function storableSecretRowNames(rows: ParameterRow[]): string[] | undefined {
  const names = [
    ...new Set(
      namedRows(rows)
        .filter((row) => row.secret)
        .map((row) => row.name),
    ),
  ];
  return names.length > 0 ? names : undefined;
}

/** The secret rows still waiting for a value, which hold the run back. */
export function missingSecretRowNames(rows: ParameterRow[]): string[] {
  return namedRows(rows)
    .filter((row) => row.secret && row.value === "")
    .map((row) => row.name);
}
