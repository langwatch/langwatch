/**
 * The rows of a comparison: one agent and one parameter line each.
 *
 * The rules that open the rows, add one, and tell two equal targets apart are
 * pure, so they can be read and tested on their own. The rows carry the line
 * as typed; what a target sends is the line parsed by `parameter-line.ts`.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import type { TargetValue } from "~/components/scenarios/TargetSelector";
import type {
  RunParameterValues,
  ScenarioParameterValue,
} from "~/server/scenarios/parameters";
import {
  canonicalOverrides,
  targetIdentityKey,
  targetSortKey,
} from "~/server/suites/target-key";
import { toLineRunParameters } from "./parameter-line";
import type { RunDialogAgent } from "./RunTargetPicker";

/** One target of the comparison, as the dialog holds it. */
export type CompareRow = {
  target: NonNullable<TargetValue>;
  parameterLine: string;
};

/** The most targets one run compares. The matrix stays readable at four. */
export const MAX_COMPARE_ROWS = 4;

/** What a row says when two of them name the same agent with the same values. */
export const DUPLICATE_TARGETS_MESSAGE =
  "Two targets are the same agent with the same parameters.";

/** The agent as a target of the run. */
function targetOfAgent(agent: RunDialogAgent): NonNullable<TargetValue> {
  return { type: agent.type, id: agent.id };
}

/**
 * The rows the section opens on.
 *
 * Both rows start with the parameter line the Parameters section held, so a
 * comparison has one layer of parameters: the one on its rows. Row one is the
 * agent that was chosen. Row two is the next agent in picker order that is
 * not row one's agent; when the project has no other agent, it is the same
 * agent, which is the "one connection, two models" case.
 */
export function initialCompareRows({
  target,
  parameterLine,
  agents,
}: {
  target: TargetValue;
  parameterLine: string;
  agents: readonly RunDialogAgent[];
}): CompareRow[] {
  // A development agent of another person cannot be run by the reader, so it
  // is never what a comparison opens on.
  const runnable = agents.filter((agent) => agent.runnable !== false);
  const firstAgent = runnable[0];
  const first = target ?? (firstAgent ? targetOfAgent(firstAgent) : null);
  if (!first) return [];

  const other = runnable.find((agent) => agent.id !== first.id);
  const second = other ? targetOfAgent(other) : first;
  return [
    { target: first, parameterLine },
    { target: second, parameterLine },
  ];
}

/**
 * One more row: a copy of the last one, agent and line, so the new row only
 * needs the one value that is to differ.
 */
export function addCompareRow(rows: readonly CompareRow[]): CompareRow[] {
  const last = rows[rows.length - 1];
  if (!last || rows.length >= MAX_COMPARE_ROWS) return [...rows];
  return [...rows, { target: last.target, parameterLine: last.parameterLine }];
}

/** The declared default of each parameter the run's scenarios name. */
export type ParameterDefaults = ReadonlyMap<string, ScenarioParameterValue>;

/**
 * What a row sends as its own overrides, or nothing for an empty line.
 *
 * A value typed equal to the declared default is no override and is left
 * out, the way the server reads it, so the dialog's duplicate check, its sort
 * order and its derived name match the server's.
 */
export function compareRowParameters({
  row,
  defaults,
}: {
  row: CompareRow;
  defaults: ParameterDefaults;
}): RunParameterValues | undefined {
  return canonicalOverrides({
    runParameters: toLineRunParameters({
      line: row.parameterLine,
      secretValues: {},
    }),
    defaults,
  });
}

/**
 * The identity of a row: its agent and its overrides, read as JSON so
 * "a=1, b=2" and "b=2, a=1" are one target and a value holding a comma is
 * never read as a second pair.
 */
export function compareRowKey({
  row,
  defaults,
}: {
  row: CompareRow;
  defaults: ParameterDefaults;
}): string {
  return targetIdentityKey({
    type: row.target.type,
    referenceId: row.target.id,
    runParameters: compareRowParameters({ row, defaults }),
  });
}

/**
 * The colour position of every row, by row index.
 *
 * The run detail colours a target by its place in the sorted target list, so a
 * row must take the colour of its place in that same order. Colouring by row
 * position instead would give one target two colours, the dot in the dialog
 * and the column of the results, whenever the rows were not added in sorted
 * order.
 */
export function compareRowColorIndexes({
  rows,
  defaults,
}: {
  rows: readonly CompareRow[];
  defaults: ParameterDefaults;
}): number[] {
  const sorted = rows
    .map((row, index) => ({
      index,
      sortKey: targetSortKey({
        type: row.target.type,
        referenceId: row.target.id,
        runParameters: compareRowParameters({ row, defaults }),
      }),
    }))
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey));

  const colorIndexes = rows.map(() => 0);
  sorted.forEach((entry, position) => {
    colorIndexes[entry.index] = position;
  });
  return colorIndexes;
}

/**
 * Whether two rows name the same agent with the same overrides. Two rows
 * that differ only by a typed default are one target.
 */
export function hasDuplicateCompareRows({
  rows,
  defaults,
}: {
  rows: readonly CompareRow[];
  defaults: ParameterDefaults;
}): boolean {
  const keys = rows.map((row) => compareRowKey({ row, defaults }));
  return new Set(keys).size !== keys.length;
}
