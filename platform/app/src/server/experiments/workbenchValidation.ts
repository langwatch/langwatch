import type { Prisma } from "~/generated/prisma/client";
import {
  COMPARISON_COLUMN_REFUSAL,
  isComparisonEvaluatorType,
} from "../../experiments-v3/types";
import {
  type PersistedEvaluationsV3State,
  persistedEvaluationsV3StateSchema,
} from "../../experiments-v3/types/persistence";
import { normalizeEvaluators } from "../../experiments-v3/utils/normalizeComparison";
import { InvalidWorkbenchStateError } from "./errors";
import type { WorkbenchReferenceType } from "./workbenchReference.repository";

/** How many zod issues travel to the caller. Enough to fix, not a dump. */
const MAX_REPORTED_ISSUES = 10;

/**
 * Every evaluator carrying a `comparison` config it cannot own.
 *
 * The field types cannot state this rule, because `comparison` is optional on
 * every evaluator and only the type decides who may set it. A state that gets
 * past it holds a column that renders as a standalone comparison and runs as a
 * judge that never receives the candidates it is asked to compare, which is
 * what the customer sees as a column that fails every row.
 */
const comparisonColumnIssues = (
  state: PersistedEvaluationsV3State,
): { path: string; message: string }[] =>
  state.evaluators.flatMap((evaluator, index) =>
    evaluator.comparison && !isComparisonEvaluatorType(evaluator.evaluatorType)
      ? [
          {
            path: `evaluators.${index}.comparison`,
            message: `Evaluator ${evaluator.id} is a ${evaluator.evaluatorType}. ${COMPARISON_COLUMN_REFUSAL}`,
          },
        ]
      : [],
  );

/**
 * Parses an incoming workbench state, or refuses the write.
 *
 * This runs before the transaction opens: a state that cannot be read is not
 * a state we want half-written, and the version counter must not move for a
 * write that was never accepted.
 */
export const parseWorkbenchState = (
  state: unknown,
): PersistedEvaluationsV3State => {
  const result = persistedEvaluationsV3StateSchema.safeParse(state);
  if (!result.success) {
    throw new InvalidWorkbenchStateError({
      issues: result.error.issues
        .slice(0, MAX_REPORTED_ISSUES)
        .map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
    });
  }

  const issues = comparisonColumnIssues(result.data);
  if (issues.length > 0) {
    throw new InvalidWorkbenchStateError({
      issues: issues.slice(0, MAX_REPORTED_ISSUES),
    });
  }

  return result.data;
};

/**
 * The stored blob, with any evaluator repaired that an earlier write left in a
 * shape the workbench cannot render.
 *
 * Rows saved before the comparison-column rule was enforced can hold a plain
 * evaluator with a `comparison` config. Repairing on read is what keeps those
 * rows editable: the next write of the row carries the attached evaluator it
 * always should have been, so the save seam accepts it instead of refusing
 * every later edit of a row nobody typed by hand.
 *
 * Same function the browser store runs at its own load boundary, so a row reads
 * the same on both sides.
 */
export const repairWorkbenchState = (
  stored: unknown,
): PersistedEvaluationsV3State | null => {
  const state = (stored as PersistedEvaluationsV3State | null) ?? null;
  if (!state || !Array.isArray(state.evaluators)) return state;
  return { ...state, evaluators: normalizeEvaluators(state.evaluators) };
};

/**
 * The single reference the executor resolves for a target, by target type.
 *
 * It mirrors `execution/dataLoader.ts`, which loads a prompt only for a prompt
 * target, an agent only for an agent target, and so on. A target keeps every
 * id it ever held, because the workbench shallow-merges target edits: a target
 * switched from prompt to agent still carries its old `promptId`. The executor
 * ignores that id, so checking it would refuse a save for a row the run never
 * reads.
 */
const TARGET_REFERENCE_BY_TYPE = {
  prompt: { refType: "prompt", field: "promptId" },
  agent: { refType: "agent", field: "dbAgentId" },
  evaluator: { refType: "evaluator", field: "targetEvaluatorId" },
  workflow: { refType: "workflow", field: "workflowId" },
} as const satisfies Record<
  PersistedEvaluationsV3State["targets"][number]["type"],
  { refType: WorkbenchReferenceType; field: string }
>;

/**
 * Every row the state points at, grouped by kind. Duplicates are kept out so
 * a state naming one prompt on six targets still costs one lookup.
 */
export const collectWorkbenchReferences = (
  state: PersistedEvaluationsV3State,
): Map<WorkbenchReferenceType, string[]> => {
  const byType = new Map<WorkbenchReferenceType, Set<string>>();

  const add = (refType: WorkbenchReferenceType, refId?: string) => {
    if (!refId) return;
    const existing = byType.get(refType) ?? new Set<string>();
    existing.add(refId);
    byType.set(refType, existing);
  };

  for (const target of state.targets) {
    const reference = TARGET_REFERENCE_BY_TYPE[target.type];
    add(reference.refType, target[reference.field]);
  }

  for (const evaluator of state.evaluators) {
    add("evaluator", evaluator.dbEvaluatorId);
  }

  for (const dataset of state.datasets) {
    if (dataset.type !== "saved") continue;
    add("dataset", dataset.datasetId);
  }

  return new Map(
    [...byType.entries()].map(([refType, ids]) => [refType, [...ids]]),
  );
};

/**
 * The snapshot form of a state: the same setup without run results.
 *
 * Results belong to the live experiment row, which is where the workbench
 * reads them. A version exists to bring a setup back, and carrying every run
 * of every version would make the history table the largest thing in the
 * database for no one's benefit.
 */
export const stripResults = (
  state: PersistedEvaluationsV3State,
): PersistedEvaluationsV3State => {
  const { results: _results, ...withoutResults } = state;
  return withoutResults;
};

/** Plain JSON, which is what Prisma stores in a Json column. */
export const toJsonValue = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
