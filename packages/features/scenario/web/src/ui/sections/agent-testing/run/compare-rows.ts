/**
 * The rows of a comparison: one agent and one parameter line each.
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import type { TargetValue } from "../../../../model/scenario-target";
import type {
  RunParameterValues,
  ScenarioParameterDefinition,
  ScenarioParameterValue,
} from "@langwatch/scenario-contract";
import { canonicalOverrides, targetIdentityKey, targetSortKey } from "@langwatch/suite-contract";
import { toLineRunParameters } from "../../../../model/agent-testing/run/parameter-line";
import type { RunDialogAgent } from "./run-target-picker";

/** One target of the comparison, as the dialog holds it. */
export type CompareRow = {
  target: NonNullable<TargetValue>;
  parameterLine: string;
};

/** The most targets one run compares. The matrix stays readable at four. */
export const MAX_COMPARE_ROWS = 4;

/** What a row says when two of them name the same agent with the same values. */
export const DUPLICATE_TARGETS_MESSAGE = "Two targets are the same agent with the same parameters.";

/** The agent as a target of the run. */
function targetOfAgent(agent: RunDialogAgent): NonNullable<TargetValue> {
  return { type: agent.type, id: agent.id };
}

/**
 * The rows the section opens on.
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
  const runnableAgents = agents.filter((agent) => agent.isRunnable !== false);
  const firstAgent = runnableAgents[0];
  const first = target ?? (firstAgent ? targetOfAgent(firstAgent) : null);
  if (!first) return [];

  const other = runnableAgents.find((agent) => agent.id !== first.id);
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

/** What the rows read their values against: the defaults and the types. */
type RowContext = {
  /** The declared defaults, which a typed value equal to does not override. */
  defaults: ParameterDefaults;
  /** The declarations in scope, for the type each value is read as. */
  definitions?: readonly ScenarioParameterDefinition[];
};

/**
 * What a row sends as its own overrides, or nothing for an empty line.
 */
export function compareRowParameters({
  row,
  defaults,
  definitions,
}: { row: CompareRow } & RowContext): RunParameterValues | undefined {
  return canonicalOverrides({
    runParameters: toLineRunParameters({
      line: row.parameterLine,
      secretValues: {},
      definitions,
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
  definitions,
}: { row: CompareRow } & RowContext): string {
  return targetIdentityKey({
    type: row.target.type,
    referenceId: row.target.id,
    runParameters: compareRowParameters({ row, defaults, definitions }),
  });
}

/**
 * The colour position of every row, by row index.
 */
export function compareRowColorIndexes({
  rows,
  defaults,
  definitions,
}: { rows: readonly CompareRow[] } & RowContext): number[] {
  const sorted = rows
    .map((row, index) => ({
      index,
      sortKey: targetSortKey({
        type: row.target.type,
        referenceId: row.target.id,
        runParameters: compareRowParameters({ row, defaults, definitions }),
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
  definitions,
}: { rows: readonly CompareRow[] } & RowContext): boolean {
  const keys = rows.map((row) => compareRowKey({ row, defaults, definitions }));
  return new Set(keys).size !== keys.length;
}
