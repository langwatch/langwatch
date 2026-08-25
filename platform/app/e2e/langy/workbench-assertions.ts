/**
 * The Layer-2 facts every prompt-improvement suite asserts, in one place.
 *
 * Two suites now grade the same loop from opposite sides, one with a page
 * attached and one without, and the parity claim between them is only worth
 * anything if both read the outcome the same way. So the outcome is a shared
 * function rather than a block copied into each file.
 *
 * Not a test file on purpose: an `expect` inside a helper that lives beside its
 * `it()` reads as a misplaced assertion, and a helper the suites share has no
 * business being in one of them.
 */

import { expect } from "vitest";
import type { EvaluationV3Event } from "~/server/experiments-v3/execution/types";
import { PROJECT_ID } from "./config";
import type { FakeTabRun, FakeWorkbenchTab } from "./fake-workbench-tab";
import {
  getWorkbenchState,
  listExperimentRuns,
} from "./seed-optimization-workbench";
import { getSessionCookie, trpcQuery } from "./trpc";
import { api } from "./workbench-rest";

/** How long a run's rows may take to become queryable before it is a failure. */
const RESULTS_VISIBILITY_TIMEOUT_MS = 60_000;

/** One evaluation row, as the run-results API carries it. */
interface RunEvaluation {
  evaluator: string;
  targetId?: string | null;
  status: "processed" | "skipped" | "error";
  index: number;
  score?: number | null;
  passed?: boolean | null;
  label?: string | null;
  details?: string | null;
}

/** The serialized baseline column, taken before Langy touches anything. */
export async function readBaselineTarget({
  slug,
  baselineTargetId,
}: {
  slug: string;
  baselineTargetId: string;
}): Promise<string> {
  const before = await getWorkbenchState(slug);
  return JSON.stringify(
    before.state.targets.find((target) => target.id === baselineTargetId),
  );
}

/**
 * The workbench a finished improvement loop leaves behind.
 *
 * The baseline column is byte-identical, at least one candidate prompt column
 * exists carrying a draft, the evaluator is wired onto a candidate rather than
 * only onto the original, and at least one run was recorded.
 */
export async function expectOptimizedWorkbench({
  slug,
  baselineTargetId,
  datasetId,
  baselineBefore,
}: {
  slug: string;
  baselineTargetId: string;
  datasetId: string;
  /** What `readBaselineTarget` answered before the conversation started. */
  baselineBefore: string;
}): Promise<void> {
  const after = await getWorkbenchState(slug);
  const baselineAfter = JSON.stringify(
    after.state.targets.find((target) => target.id === baselineTargetId),
  );
  expect(baselineAfter).toBe(baselineBefore);

  const candidates = after.state.targets.filter(
    (target) => target.id !== baselineTargetId && target.type === "prompt",
  );
  expect(
    candidates.length,
    "no candidate prompt column was created beside the baseline",
  ).toBeGreaterThan(0);
  expect(
    candidates.some((target) => target.localPromptConfig),
    "no candidate column carries a prompt draft",
  ).toBe(true);

  const evaluator = after.state.evaluators[0];
  expect(evaluator, "the workbench holds no evaluator").toBeDefined();
  const evaluatorTargets = Object.keys(evaluator!.mappings[datasetId] ?? {});
  expect(
    candidates.some((target) => evaluatorTargets.includes(target.id)),
    `the evaluator is mapped onto ${JSON.stringify(evaluatorTargets)}, none of which is a candidate column`,
  ).toBe(true);

  expect(
    (await listExperimentRuns(slug)).length,
    "no run was recorded for the experiment",
  ).toBeGreaterThan(0);
}

/** The newest run recorded for an experiment, or undefined when there is none. */
export async function newestRunId(slug: string): Promise<string | undefined> {
  const runs = await listExperimentRuns(slug);
  return runs[0]?.runId;
}

/** Every evaluation row a run recorded, polled until ClickHouse has them. */
export async function readRunEvaluations({
  slug,
  runId,
}: {
  slug: string;
  runId: string;
}): Promise<RunEvaluation[]> {
  const deadline = Date.now() + RESULTS_VISIBILITY_TIMEOUT_MS;
  let last: RunEvaluation[] = [];
  // ClickHouse writes are not synchronous with the stream's terminal frame, so
  // a single read can answer for a run whose rows have not landed yet.
  while (Date.now() < deadline) {
    const result = await api({
      method: "GET",
      path: `/api/experiments/runs/${encodeURIComponent(runId)}/results?experimentSlug=${encodeURIComponent(slug)}`,
    });
    last = Array.isArray(result?.evaluations) ? result.evaluations : [];
    if (last.length > 0) return last;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return last;
}

/**
 * A run that really scored something.
 *
 * This is what turns "a subset ran" from a judge opinion into a fact: a row the
 * evaluator processed, carrying a number or a verdict. A run that only recorded
 * skips and errors passes every shape-only check and measures nothing.
 */
export async function expectRunHasRealScores({
  slug,
  runId,
}: {
  slug: string;
  runId: string;
}): Promise<void> {
  const evaluations = await readRunEvaluations({ slug, runId });
  expect(
    evaluations.length,
    `run ${runId} recorded no evaluations at all`,
  ).toBeGreaterThan(0);
  const scored = evaluations.filter(
    (evaluation) =>
      evaluation.status === "processed" &&
      (typeof evaluation.score === "number" ||
        typeof evaluation.passed === "boolean" ||
        // A comparison reports its winner as a label rather than a number.
        (typeof evaluation.label === "string" && evaluation.label !== "")),
  );
  expect(
    scored.length,
    `run ${runId} recorded ${evaluations.length} evaluations but none carries a score or a verdict: ${JSON.stringify(
      evaluations.slice(0, 3),
    )}`,
  ).toBeGreaterThan(0);
}

// ── what a run left on the board ────────────────────────────────────────────

/** Every verdict cell one evaluator wrote during a run. */
const verdictsOf = ({
  run,
  evaluatorId,
}: {
  run: FakeTabRun;
  evaluatorId: string;
}): Array<{ rowIndex: number; result: Record<string, unknown> }> =>
  run.events
    .filter(
      (
        event,
      ): event is Extract<EvaluationV3Event, { type: "evaluator_result" }> =>
        event.type === "evaluator_result" && event.evaluatorId === evaluatorId,
    )
    .map((event) => ({
      rowIndex: event.rowIndex,
      result: (event.result ?? {}) as Record<string, unknown>,
    }));

/**
 * A comparison that judged what it was asked to, with nothing left waiting.
 *
 * `MissingVariantOutput` and the "Waiting on …" sentence both come from
 * `comparisonSkipMessage` in the orchestrator, and either one means the run
 * asked the judge to compare an output it was never given.
 */
export function expectComparisonScored({
  run,
  evaluatorId,
}: {
  run: FakeTabRun;
  evaluatorId: string;
}): void {
  const verdicts = verdictsOf({ run, evaluatorId });
  expect(
    verdicts.length,
    `the comparison wrote no cell at all: ${JSON.stringify(
      run.events.map((event) => event.type),
    )}`,
  ).toBeGreaterThan(0);

  const waiting = verdicts.filter(
    ({ result }) =>
      result.error_type === "MissingVariantOutput" ||
      (typeof result.details === "string" &&
        result.details.startsWith("Waiting on ")),
  );
  expect(
    waiting,
    `the comparison is waiting on a column whose output the run should have seeded: ${JSON.stringify(
      waiting.slice(0, 2),
    )}`,
  ).toEqual([]);

  const failed = verdicts.filter(({ result }) => result.status === "error");
  expect(
    failed,
    `the comparison failed rows: ${JSON.stringify(failed.slice(0, 2))}`,
  ).toEqual([]);

  const decided = verdicts.filter(
    ({ result }) =>
      typeof result.label === "string" ||
      typeof result.score === "number" ||
      typeof result.passed === "boolean",
  );
  expect(
    decided.length,
    `no row carries a verdict: ${JSON.stringify(verdicts.slice(0, 2))}`,
  ).toBeGreaterThan(0);
}

/** Every column named produced an output for every row the run covered. */
export function expectColumnsFilled({
  tab,
  targetIds,
  rows,
}: {
  tab: FakeWorkbenchTab;
  targetIds: string[];
  rows: number;
}): void {
  const results = tab.state().results;
  for (const targetId of targetIds) {
    const summary = results?.targets.find(
      (target) => target.targetId === targetId,
    );
    expect(summary, `no results for column ${targetId}`).toBeDefined();
    expect(
      summary?.filledCells,
      `column ${targetId} filled ${summary?.filledCells} of ${rows} rows`,
    ).toBe(rows);
  }
}

// ── what the conversation recorded ──────────────────────────────────────────

/** One part of a recorded assistant message. */
interface RecordedPart {
  type?: unknown;
  text?: unknown;
}

/**
 * The recorded turn keeps the order the turn happened in.
 *
 * A turn is a sequence: a paragraph, a call, another paragraph, another call.
 * A record that holds every call first and one closing paragraph gives a
 * reader who refreshes a pile of cards and no account of the work.
 * Read the way the panel reads it on reload, and asserted as the interleaving
 * rather than as a count, because how many calls a turn makes is the model's
 * business and how they are ordered is not.
 */
export async function expectInterleavedTranscript(
  conversationId: string | null,
): Promise<void> {
  expect(conversationId, "the scenario recorded no conversation").toBeTruthy();
  const { messages } = await trpcQuery<{
    messages: { role: string; parts: RecordedPart[] }[];
  }>({
    cookie: await getSessionCookie(),
    path: "langy.messages",
    input: { projectId: PROJECT_ID, conversationId },
  });

  const working = messages
    .filter((message) => message.role === "assistant")
    .map((message) => {
      const texts: number[] = [];
      const tools: number[] = [];
      message.parts.forEach((part, index) => {
        if (typeof part.type !== "string") return;
        if (part.type === "text") {
          if (typeof part.text === "string" && part.text.trim()) {
            texts.push(index);
          }
          return;
        }
        if (part.type.startsWith("tool-")) tools.push(index);
      });
      return { texts, tools };
    })
    .filter((message) => message.tools.length > 0);

  expect(
    working.length,
    "no recorded assistant message ran a tool, so there is no order to read",
  ).toBeGreaterThan(0);

  const interleaved = working.filter(
    (message) =>
      message.texts.length > 1 &&
      message.texts[0]! < message.tools[message.tools.length - 1]!,
  );
  expect(
    interleaved.length,
    `every recorded turn put its whole reply after its last call: ${JSON.stringify(
      working,
    )}`,
  ).toBeGreaterThan(0);
}
