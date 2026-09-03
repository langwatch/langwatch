/**
 * Seeds the evaluations workbench the prompt-optimization scenarios run
 * against: a support-bot prompt, an inline dataset, and (per variant) a
 * mapped evaluator, all through the same REST surface any integration uses,
 * so a passing seed also proves the workbench-state endpoints work.
 *
 * No baseline run is seeded: the skill's own first step is a scoped run, the
 * scenarios grade that behavior, and a pre-seeded run would cost model calls
 * per suite run without making any scenario more deterministic.
 *
 * Names carry a minute stamp, so a re-run within the minute seeds a fresh
 * experiment on top of the prompt the last run created, and a later run gets a
 * prompt of its own (same reasoning as the dogfood trace fixtures).
 */

import { PROJECT_ID } from "./config";
import {
  CLASSIFIER_PROMPT,
  FREE_TEXT_ROWS,
  LABEL_ROWS,
  SUPPORT_PROMPT,
} from "./seed-optimization-rows";
import { getSessionCookie, trpcMutate } from "./trpc";
import { api, ensurePromptId } from "./workbench-rest";

const RUN_STAMP = String(Math.floor(Date.now() / 60_000));

const DATASET_ID = "dataset-seed";
const BASELINE_TARGET_ID = "target-baseline";

export interface SeededWorkbench {
  experimentSlug: string;
  experimentId: string;
  datasetId: string;
  baselineTargetId: string;
  promptId: string;
  version: number;
}

export type GoldenStyle = "free-text" | "label" | "none";

const datasetField = (field: string) => ({
  type: "source" as const,
  source: "dataset" as const,
  sourceId: DATASET_ID,
  sourceField: field,
});

const baselineOutput = () => ({
  type: "source" as const,
  source: "target" as const,
  sourceId: BASELINE_TARGET_ID,
  sourceField: "output",
});

/**
 * The inline dataset. Asking for more rows than the fixture holds cycles it
 * and stamps the repeats, so the cases stay distinct at any size.
 */
function buildDataset({
  name,
  rows,
  goldenStyle,
  withContexts,
}: {
  name: string;
  rows: number;
  goldenStyle: GoldenStyle;
  withContexts: boolean;
}) {
  const source = goldenStyle === "label" ? LABEL_ROWS : FREE_TEXT_ROWS;
  const picked = Array.from(
    { length: rows },
    (_, i) => source[i % source.length]!,
  );

  const columns = [
    { id: "input", name: "input", type: "string" },
    ...(goldenStyle === "none"
      ? []
      : [{ id: "expected_output", name: "expected_output", type: "string" }]),
    ...(withContexts
      ? [{ id: "contexts", name: "contexts", type: "list" }]
      : []),
  ];
  const records: Record<string, string[]> = {
    input: picked.map((row, i) =>
      i >= source.length ? `${row.input} (case ${i})` : row.input,
    ),
  };
  if (goldenStyle !== "none") {
    records.expected_output = picked.map((row) => row.expected);
  }
  if (withContexts) {
    // A "list" column holds JSON: the execution loader parses every cell of it
    // and keeps whatever fails to parse as a plain string. The faithfulness
    // evaluator takes `contexts` as a list of strings, so each cell ships as a
    // JSON array rather than as the bare sentence.
    records.contexts = picked.map((row) =>
      JSON.stringify([`Brightcart policy notes relevant to: ${row.input}`]),
    );
  }

  return {
    id: DATASET_ID,
    name: `${name} dataset`,
    type: "inline",
    inline: { columns, records },
    columns,
  };
}

/** The prompt column the loop treats as the control. */
function buildBaselineTarget({ promptId }: { promptId: string }) {
  return {
    id: BASELINE_TARGET_ID,
    type: "prompt",
    promptId,
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    mappings: {
      [DATASET_ID]: { input: datasetField("input") },
    },
  };
}

/** Grades a free-text answer against the golden one, wired onto the baseline. */
function buildAnswerMatchEvaluator() {
  return {
    id: "evaluator-answer-match",
    evaluatorType: "langevals/llm_answer_match",
    inputs: [
      { identifier: "input", type: "str" },
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ],
    mappings: {
      [DATASET_ID]: {
        [BASELINE_TARGET_ID]: {
          input: datasetField("input"),
          output: baselineOutput(),
          expected_output: datasetField("expected_output"),
        },
      },
    },
  };
}

/** Grades a label, which is right or wrong with nothing in between. */
function buildExactMatchEvaluator() {
  return {
    id: "evaluator-exact-match",
    evaluatorType: "langevals/exact_match",
    inputs: [
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ],
    mappings: {
      [DATASET_ID]: {
        [BASELINE_TARGET_ID]: {
          output: baselineOutput(),
          expected_output: datasetField("expected_output"),
        },
      },
    },
  };
}

/**
 * The evaluator each golden style grades with. "none" seeds no golden column,
 * so it seeds no evaluator either: an evaluator mapped to `expected_output`
 * would point at a field the dataset does not hold.
 */
function buildEvaluators({ goldenStyle }: { goldenStyle: GoldenStyle }) {
  if (goldenStyle === "none") return [];
  return goldenStyle === "label"
    ? [buildExactMatchEvaluator()]
    : [buildAnswerMatchEvaluator()];
}

/**
 * Builds and saves the experiment. Variants:
 * - rows: 0 seeds the empty-dataset bootstrap case; 20 is the loop default;
 *   120 crosses the skill's 100-row ask-before-spending threshold.
 * - goldenStyle: "free-text" pairs with llm_answer_match, "label" with
 *   exact_match, "none" seeds inputs only (the comparison case).
 * - withEvaluator: whether the golden style's evaluator is pre-wired
 *   (bootstrap scenarios seed without it).
 * - withContexts: adds a contexts column (the faithfulness case).
 */
export async function seedOptimizationWorkbench({
  name,
  rows,
  goldenStyle,
  withEvaluator,
  withContexts = false,
}: {
  name: string;
  rows: number;
  goldenStyle: GoldenStyle;
  withEvaluator: boolean;
  withContexts?: boolean;
}): Promise<SeededWorkbench> {
  const stampedName = `${name}-${RUN_STAMP}`;
  const promptId = await ensurePromptId({
    handle: stampedName,
    prompt: goldenStyle === "label" ? CLASSIFIER_PROMPT : SUPPORT_PROMPT,
  });

  const state = {
    name,
    datasets: [buildDataset({ name, rows, goldenStyle, withContexts })],
    activeDatasetId: DATASET_ID,
    evaluators: withEvaluator ? buildEvaluators({ goldenStyle }) : [],
    targets: [buildBaselineTarget({ promptId })],
  };

  const created = await api({
    method: "POST",
    path: "/api/experiments",
    body: { name: stampedName, state },
  });
  return {
    experimentSlug: created.slug,
    experimentId: created.id,
    datasetId: DATASET_ID,
    baselineTargetId: BASELINE_TARGET_ID,
    promptId,
    version: created.version,
  };
}

// ============================================================================
// Comparison workbenches
// ============================================================================

/** The judge that compares candidate columns against each other. */
const COMPARISON_EVALUATOR_TYPE = "langevals/select_best_compare";

const CANDIDATE_TARGET_ID = "target-candidate";
const COMPARISON_TARGET_ID = "target-comparison";
const COMPARISON_EVALUATOR_ID = "evaluator-comparison";

/**
 * The comparison judge's own fields, as the product derives them from the
 * evaluator catalog when a column is added. All four are optional and typed
 * `str`; the orchestrator fills them per row with baked value mappings.
 */
const COMPARISON_INPUTS = [
  { identifier: "input", type: "str", optional: true },
  { identifier: "golden", type: "str", optional: true },
  { identifier: "candidates", type: "str", optional: true },
  { identifier: "row_index", type: "str", optional: true },
];

const COMPARISON_OUTPUTS = [
  { identifier: "passed", type: "bool" },
  { identifier: "score", type: "float" },
  { identifier: "label", type: "str" },
];

/** A second prompt, so the two columns have something to disagree about. */
const TERSE_SUPPORT_PROMPT =
  "You answer Brightcart support questions in one short sentence. State the policy and nothing else.";

/** Which shape carries the comparison. Both leave the same hole in a scoped run. */
export type ComparisonCarrier = "column-target" | "chip-evaluator";

export interface SeededComparison extends SeededWorkbench {
  candidateTargetId: string;
  /** The column-target's id, or the chip evaluator's id, per carrier. */
  comparisonId: string;
  candidatePromptId: string;
}

const comparisonConfig = () => ({
  variants: [BASELINE_TARGET_ID, CANDIDATE_TARGET_ID],
  hasGoldenAnswer: true,
  goldenField: "expected_output",
  includeMetrics: [],
  randomizeOrder: true,
});

/**
 * The saved evaluator a column-style comparison needs behind it: the
 * orchestrator skips any column-target with no `targetEvaluatorId`.
 *
 * Created the way the workbench's own "New Comparison" flow creates it: the
 * `evaluators.create` mutation, as the signed-in user. The REST create is a
 * different door: it resolves the project's embeddings model on the way in,
 * for a topic-clustering feature this judge never touches, and refuses on a
 * project that has no embeddings model configured.
 */
async function createSavedComparisonJudge({
  stampedName,
}: {
  stampedName: string;
}): Promise<string> {
  const saved = await trpcMutate<{ id: string }>({
    cookie: await getSessionCookie(),
    path: "evaluators.create",
    input: {
      projectId: PROJECT_ID,
      name: `${stampedName} comparison`,
      type: "evaluator",
      config: {
        evaluatorType: COMPARISON_EVALUATOR_TYPE,
        settings: { has_golden_answer: true },
      },
    },
  });
  return saved.id;
}

/** The comparison as a column-target of its own. */
function buildComparisonTarget({ judgeId }: { judgeId: string }) {
  return {
    id: COMPARISON_TARGET_ID,
    type: "evaluator",
    targetEvaluatorId: judgeId,
    inputs: COMPARISON_INPUTS,
    outputs: COMPARISON_OUTPUTS,
    comparison: comparisonConfig(),
    mappings: {
      [DATASET_ID]: {
        input: datasetField("input"),
        golden: datasetField("expected_output"),
      },
    },
  };
}

/** The same comparison as a chip attached to the board. */
function buildComparisonEvaluator({ judgeId }: { judgeId: string }) {
  return {
    id: COMPARISON_EVALUATOR_ID,
    evaluatorType: COMPARISON_EVALUATOR_TYPE,
    dbEvaluatorId: judgeId,
    inputs: COMPARISON_INPUTS,
    mappings: {},
    comparison: comparisonConfig(),
  };
}

/**
 * A workbench holding two prompt columns and one comparison over them.
 *
 * The carrier decides which shape holds the comparison: a column-target of its
 * own, or a chip attached to the board. A scoped run has the same hole either
 * way: the judge needs every variant's output for the row, and a run that
 * covers only one of them has nothing to compare unless the others are seeded.
 */
export async function seedComparisonWorkbench({
  name,
  rows,
  carrier,
}: {
  name: string;
  rows: number;
  carrier: ComparisonCarrier;
}): Promise<SeededComparison> {
  const stampedName = `${name}-${RUN_STAMP}`;
  const promptId = await ensurePromptId({
    handle: stampedName,
    prompt: SUPPORT_PROMPT,
  });
  const candidatePromptId = await ensurePromptId({
    handle: `${stampedName}-candidate`,
    prompt: TERSE_SUPPORT_PROMPT,
  });

  const candidateTarget = {
    ...buildBaselineTarget({ promptId: candidatePromptId }),
    id: CANDIDATE_TARGET_ID,
  };

  const savedJudgeId = await createSavedComparisonJudge({ stampedName });

  const isColumn = carrier === "column-target";
  const state = {
    name,
    datasets: [
      buildDataset({
        name,
        rows,
        goldenStyle: "free-text",
        withContexts: false,
      }),
    ],
    activeDatasetId: DATASET_ID,
    evaluators: isColumn
      ? []
      : [buildComparisonEvaluator({ judgeId: savedJudgeId })],
    targets: [
      buildBaselineTarget({ promptId }),
      candidateTarget,
      ...(isColumn ? [buildComparisonTarget({ judgeId: savedJudgeId })] : []),
    ],
  };

  const created = await api({
    method: "POST",
    path: "/api/experiments",
    body: { name: stampedName, state },
  });
  return {
    experimentSlug: created.slug,
    experimentId: created.id,
    datasetId: DATASET_ID,
    baselineTargetId: BASELINE_TARGET_ID,
    candidateTargetId: CANDIDATE_TARGET_ID,
    comparisonId: isColumn ? COMPARISON_TARGET_ID : COMPARISON_EVALUATOR_ID,
    promptId,
    candidatePromptId,
    version: created.version,
  };
}

/** One evaluator input's source, as the workbench saves it. */
export interface SavedFieldMapping {
  type: string;
  source?: string;
  sourceId?: string;
  sourceField?: string;
}

export interface SavedEvaluator {
  id: string;
  evaluatorType: string;
  comparison?: { variants: string[]; hasGoldenAnswer?: boolean };
  mappings: Record<
    string,
    Record<string, Record<string, SavedFieldMapping | undefined>>
  >;
}

/** Layer-2 read: the saved workbench state, straight from the REST surface. */
export async function getWorkbenchState(slug: string): Promise<{
  id: string;
  slug: string;
  name: string;
  version: number;
  state: {
    datasets: Array<{
      id: string;
      inline?: { records: Record<string, string[]> };
    }>;
    targets: Array<{
      id: string;
      type: string;
      promptId?: string;
      localPromptConfig?: unknown;
      comparison?: { variants: string[]; hasGoldenAnswer?: boolean };
      mappings: Record<string, Record<string, unknown>>;
    }>;
    evaluators: SavedEvaluator[];
  };
}> {
  return api({
    method: "GET",
    path: `/api/experiments/${slug}/workbench-state`,
  });
}

/** Layer-2 read: the runs recorded for an experiment, newest first. */
export async function listExperimentRuns(
  slug: string,
): Promise<Array<{ runId: string; status?: string }>> {
  const result = await api({
    method: "GET",
    path: `/api/experiments/runs?experimentSlug=${encodeURIComponent(slug)}&pageSize=50`,
  });
  return Array.isArray(result?.runs) ? result.runs : [];
}
