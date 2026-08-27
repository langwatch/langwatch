import { z } from "zod";
import {
  COMPARISON_COLUMN_REFUSAL,
  isComparisonEvaluatorType,
  type ComparisonEvaluatorConfig,
  type PairwiseEvaluatorConfig,
} from "./experiment-workbench";
import {
  persistedEvaluationsV3StateSchema,
  persistedResultsSchema,
  type PersistedEvaluationsV3State,
} from "./experiment-workbench-persistence";
import { InvalidWorkbenchStateError } from "./experiment.errors";

export const WORKBENCH_ACTOR_LABELS = ["user", "langy", "api"] as const;

export const workbenchActorLabelSchema = z.enum(WORKBENCH_ACTOR_LABELS);
export type WorkbenchActorLabel = z.infer<typeof workbenchActorLabelSchema>;

export const workbenchActorSchema = z.object({
  userId: z.string().optional(),
  label: workbenchActorLabelSchema,
  runId: z.string().optional(),
});
export type WorkbenchActor = z.infer<typeof workbenchActorSchema>;

export const workbenchReferenceTypeSchema = z.enum([
  "prompt",
  "agent",
  "evaluator",
  "workflow",
  "dataset",
]);
export type WorkbenchReferenceType = z.infer<typeof workbenchReferenceTypeSchema>;

const targetReferenceByType = {
  prompt: { refType: "prompt", field: "promptId" },
  agent: { refType: "agent", field: "dbAgentId" },
  evaluator: { refType: "evaluator", field: "targetEvaluatorId" },
  workflow: { refType: "workflow", field: "workflowId" },
} as const satisfies Record<
  PersistedEvaluationsV3State["targets"][number]["type"],
  { refType: WorkbenchReferenceType; field: string }
>;

/** References the executor resolves from a persisted workbench state. */
export const collectWorkbenchReferences = (
  state: PersistedEvaluationsV3State,
): Map<WorkbenchReferenceType, string[]> => {
  const grouped = new Map<WorkbenchReferenceType, Set<string>>();
  const add = (type: WorkbenchReferenceType, id?: string) => {
    if (!id) {
      return;
    }

    const ids = grouped.get(type) ?? new Set<string>();
    ids.add(id);
    grouped.set(type, ids);
  };

  for (const target of state.targets) {
    const reference = targetReferenceByType[target.type];
    add(reference.refType, target[reference.field]);
  }

  for (const evaluator of state.evaluators) {
    add("evaluator", evaluator.dbEvaluatorId);
  }

  for (const dataset of state.datasets) {
    if (dataset.type === "saved") {
      add("dataset", dataset.datasetId);
    }
  }

  return new Map([...grouped].map(([type, ids]) => [type, [...ids]]));
};

export const workbenchValidationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type WorkbenchValidationIssue = z.infer<typeof workbenchValidationIssueSchema>;

export const workbenchStateViewSchema = z.object({
  experimentId: z.string(),
  slug: z.string(),
  name: z.string().nullable(),
  state: persistedEvaluationsV3StateSchema.nullable(),
  version: z.number(),
  updatedAt: z.date(),
  actorLabel: workbenchActorLabelSchema.optional(),
  runId: z.string().optional(),
});
export type WorkbenchStateView = z.infer<typeof workbenchStateViewSchema>;

export const workbenchSaveResultSchema = z.object({
  experimentId: z.string(),
  slug: z.string(),
  version: z.number(),
});
export type WorkbenchSaveResult = z.infer<typeof workbenchSaveResultSchema>;

export const workbenchVersionSummarySchema = z.object({
  version: z.number(),
  counterVersion: z.number(),
  autoSaved: z.boolean(),
  commitMessage: z.string().nullable(),
  authorId: z.string().nullable(),
  authorLabel: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type WorkbenchVersionSummary = z.infer<typeof workbenchVersionSummarySchema>;

const workbenchLocatorSchema = z.object({
  projectId: z.string(),
  id: z.string().optional(),
  slug: z.string().optional(),
});

export const getWorkbenchStateInputSchema = workbenchLocatorSchema;
export type GetWorkbenchStateInput = z.infer<typeof getWorkbenchStateInputSchema>;

export const saveWorkbenchStateInputSchema = workbenchLocatorSchema.extend({
  state: z.unknown(),
  expectedVersion: z.number().optional(),
  actor: workbenchActorSchema,
  commitMessage: z.string().optional(),
});
export type SaveWorkbenchStateInput = z.infer<typeof saveWorkbenchStateInputSchema>;

export const createEvaluationsV3InputSchema = z.object({
  projectId: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  state: z.unknown(),
  actor: workbenchActorSchema,
  commitMessage: z.string().optional(),
});
export type CreateEvaluationsV3Input = z.infer<typeof createEvaluationsV3InputSchema>;

export const commitWorkbenchVersionInputSchema = z.object({
  projectId: z.string(),
  id: z.string(),
  commitMessage: z.string(),
  actor: workbenchActorSchema,
});
export type CommitWorkbenchVersionInput = z.infer<typeof commitWorkbenchVersionInputSchema>;

export const listWorkbenchVersionsInputSchema = z.object({
  projectId: z.string(),
  id: z.string(),
  limit: z.number().optional(),
  cursor: z.number().optional(),
});
export type ListWorkbenchVersionsInput = z.infer<typeof listWorkbenchVersionsInputSchema>;

export const workbenchVersionsPageSchema = z.object({
  versions: z.array(workbenchVersionSummarySchema),
  nextCursor: z.number().nullable(),
});
export type WorkbenchVersionsPage = z.infer<typeof workbenchVersionsPageSchema>;

export const restoreWorkbenchVersionInputSchema = z.object({
  projectId: z.string(),
  id: z.string(),
  version: z.number(),
  actor: workbenchActorSchema,
});
export type RestoreWorkbenchVersionInput = z.infer<typeof restoreWorkbenchVersionInputSchema>;

/**
 * Writes the cells produced by one completed run into the current workbench.
 *
 * The runner computes the scoped merge from its execution plan, while the
 * service owns the read-version-write compare-and-set that makes that merge a
 * durable workbench change.
 */
export const recordWorkbenchRunResultsInputSchema = z.object({
  projectId: z.string(),
  id: z.string(),
  results: persistedResultsSchema,
  expectedVersion: z.number(),
  actor: workbenchActorSchema,
  commitMessage: z.string(),
});
export type RecordWorkbenchRunResultsInput = z.infer<typeof recordWorkbenchRunResultsInputSchema>;

const MAX_REPORTED_ISSUES = 10;

const comparisonColumnIssues = (state: PersistedEvaluationsV3State): WorkbenchValidationIssue[] =>
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

/** Parse incoming state before a write so validation errors retain their wire code. */
export const parseWorkbenchState = (state: unknown): PersistedEvaluationsV3State => {
  const result = persistedEvaluationsV3StateSchema.safeParse(state);
  if (!result.success) {
    throw new InvalidWorkbenchStateError({
      issues: result.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({
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

const fromPairwise = (pairwise: PairwiseEvaluatorConfig): ComparisonEvaluatorConfig => {
  const variants = [pairwise.variantA, pairwise.variantB];
  const variantOutputPaths: Record<string, string[]> = {};

  if (pairwise.variantA && pairwise.variantAOutputPath?.length) {
    variantOutputPaths[pairwise.variantA] = pairwise.variantAOutputPath;
  }
  if (pairwise.variantB && pairwise.variantBOutputPath?.length) {
    variantOutputPaths[pairwise.variantB] = pairwise.variantBOutputPath;
  }

  return {
    variants,
    ...(Object.keys(variantOutputPaths).length > 0 ? { variantOutputPaths } : {}),
    hasGoldenAnswer: pairwise.hasGoldenAnswer ?? true,
    goldenField: pairwise.goldenField,
    includeMetrics: pairwise.includeMetrics ?? [],
    randomizeOrder: true,
  };
};

type PersistedWorkbenchEvaluator = PersistedEvaluationsV3State["evaluators"][number];

const normalizeEvaluator = (
  evaluator: PersistedWorkbenchEvaluator,
): PersistedWorkbenchEvaluator => {
  if (evaluator.comparison || !evaluator.pairwise) return evaluator;

  const { pairwise: _pairwise, ...withoutPairwise } = evaluator;
  return { ...withoutPairwise, comparison: fromPairwise(_pairwise) };
};

/** Repair only legacy evaluator comparison data; results and targets stay intact. */
export const repairWorkbenchState = (stored: unknown): PersistedEvaluationsV3State | null => {
  const state = (stored as PersistedEvaluationsV3State | null) ?? null;
  if (!state || !Array.isArray(state.evaluators)) return state;

  return { ...state, evaluators: state.evaluators.map(normalizeEvaluator) };
};

/** Version snapshots keep setup, not run output or evaluator scores. */
export const stripWorkbenchResults = (
  state: PersistedEvaluationsV3State,
): PersistedEvaluationsV3State => {
  const { results: _results, ...withoutResults } = state;
  return withoutResults;
};
