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
import type { RunParameterValues } from "~/server/scenarios/parameters";
import { parametersKey } from "~/server/suites/plan-config";
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
 * Row one is the agent that was chosen, with the parameter line the
 * Parameters section held. Row two is the next agent in picker order that is
 * not row one's agent; when the project has no other agent, it is the same
 * agent with an empty line, which is the "one connection, two models" case.
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
  const firstAgent = agents[0];
  const first = target ?? (firstAgent ? targetOfAgent(firstAgent) : null);
  if (!first) return [];

  const other = agents.find((agent) => agent.id !== first.id);
  const second = other ? targetOfAgent(other) : first;
  return [
    { target: first, parameterLine },
    { target: second, parameterLine: "" },
  ];
}

/** One more row: the agent of row one, with an empty line. */
export function addCompareRow(rows: readonly CompareRow[]): CompareRow[] {
  const first = rows[0];
  if (!first || rows.length >= MAX_COMPARE_ROWS) return [...rows];
  return [...rows, { target: first.target, parameterLine: "" }];
}

/** What a row sends as its own overrides, or nothing for an empty line. */
export function compareRowParameters(
  row: CompareRow,
): RunParameterValues | undefined {
  return toLineRunParameters({ line: row.parameterLine, secretValues: {} });
}

/**
 * The identity of a row: its agent and its overrides, with the pairs sorted so
 * "a=1, b=2" and "b=2, a=1" are one target.
 */
export function compareRowKey(row: CompareRow): string {
  return `${row.target.type}:${row.target.id}|${parametersKey(
    compareRowParameters(row),
  )}`;
}

/** Whether two rows name the same agent with the same overrides. */
export function hasDuplicateCompareRows(rows: readonly CompareRow[]): boolean {
  const keys = rows.map(compareRowKey);
  return new Set(keys).size !== keys.length;
}
