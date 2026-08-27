/**
 * The parameter overrides of a run, as rows.
 *
 * The single line `name=value, name=value` is the small case. The moment a
 * value must be hidden the line cannot carry it, because a line shows what it
 * holds, so the block turns into one row per parameter: a key, a value, and a
 * lock that says the value is a credential.
 *
 * Everything here is pure, so the rules that move a line into rows and back
 * can be read and tested on their own.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import type { RunParameterValues } from "@langwatch/scenario-contract";
import { serializeOptionalScalarValue } from "~/utils/jsonValueText";
import { parseParameterLine } from "./parameter-line";

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
 *
 * A secret row is left out: the line would show what it holds, which is why
 * the block cannot go back to one line while a row is secret.
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
 * What the run sends: every named row, plus whatever was typed for the
 * secrets the cases declare.
 *
 * A name is sent as it was written, declared or not, so a name no case
 * declares is refused by the server by name rather than dropped in silence.
 * A plain row left with an empty value is omitted, so the run falls back to
 * the default each case declares for it. A secret keeps whatever was typed as
 * text: a token of digits is still a token.
 */
export function toRowsRunParameters({
  rows,
  secretValues,
}: {
  rows: ParameterRow[];
  /** The value typed for each declared secret parameter, keyed by name. */
  secretValues: Record<string, string>;
}): RunParameterValues | undefined {
  const parameters: RunParameterValues = {};

  for (const row of namedRows(rows)) {
    const value = rowValueOf(row);
    if (value !== undefined) parameters[row.name] = value;
  }

  for (const [name, typed] of Object.entries(secretValues)) {
    if (typed !== "") parameters[name] = typed;
  }

  return Object.keys(parameters).length > 0 ? parameters : undefined;
}

/** What a row sends, or nothing when it was left empty. */
function rowValueOf(row: ParameterRow) {
  if (!row.secret) return serializeOptionalScalarValue(row.value);
  return row.value === "" ? undefined : row.value;
}

/**
 * What the suite is allowed to remember: the plain rows and their values.
 *
 * A row left with an empty value is dropped, the way the line drops one: the
 * run falls back to the default the cases declare for that name.
 */
export function toStorableRowParameters(rows: ParameterRow[]): RunParameterValues | undefined {
  const parameters: RunParameterValues = {};
  for (const row of namedRows(rows)) {
    if (row.secret) continue;
    const value = serializeOptionalScalarValue(row.value);
    if (value === undefined) continue;
    parameters[row.name] = value;
  }
  return Object.keys(parameters).length > 0 ? parameters : undefined;
}

/**
 * The keys of the secret rows, which is all a suite may remember of them.
 *
 * The next dialog shows the row again with an empty value, so a run that
 * needs a credential asks for it every time instead of losing the row.
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
