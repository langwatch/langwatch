import {
  countRunOutcomes,
  passRateFrom,
} from "~/server/scenarios/run-outcome-summary";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { categorizeRunStatus } from "~/server/scenarios/scenario-run-category";
import type {
  CriterionFact,
  CriterionOutcome,
  FailureSignature,
  PriorBatchFact,
  ReportEvidence,
  RunFact,
  TrendFact,
} from "../report.types";
import { buildPassRateFact } from "./confidence";
import {
  criterionIdFor,
  normalizeErrorShape,
  signatureIdFor,
} from "./fingerprint";
import { classifyTrend, type TrendHistoryEntry } from "./trend";

/**
 * Turns run records into the fact pack the rest of the report is built from.
 *
 * Everything here is computed without a model. That is deliberate: it is what
 * lets the report render when no model is configured, and it is what a model is
 * later restricted to citing, so the writing can only ever describe things that
 * were actually measured.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

/** How many previous runs to compare against. Enough to see a pattern. */
export const TREND_WINDOW = 10;

export function buildEvidence({
  runs,
  priorRuns,
  batchRunId,
  scenarioSetId,
  suiteName,
  priorBatchOrder,
}: {
  runs: ScenarioRunData[];
  /** Runs from previous batches, any order. */
  priorRuns: ScenarioRunData[];
  batchRunId: string;
  scenarioSetId: string;
  suiteName: string | null;
  /** Prior batch ids, oldest first. */
  priorBatchOrder: string[];
}): ReportEvidence {
  const counts = countRunOutcomes({ statuses: runs.map((run) => run.status) });
  const runFacts = runs.map(toRunFact);
  const criteria = buildCriterionFacts(runFacts);
  const signatures = buildSignatures({ runFacts, criteria });
  const priorBatches = buildPriorBatches({ priorRuns, priorBatchOrder });
  const trend = buildTrend({
    runFacts,
    criteria,
    priorRuns,
    priorBatchOrder,
    batchRunId,
  });

  return {
    batch: {
      batchRunId,
      scenarioSetId,
      suiteName,
      startedAt: runs.reduce(
        (min, run) => Math.min(min, run.timestamp),
        Number.POSITIVE_INFINITY,
      ),
      durationMs: runs.reduce((sum, run) => sum + (run.durationInMs || 0), 0),
      totalCost: sumCost(runs),
    },
    counts,
    passRate: buildPassRateFact({
      passedCount: counts.passedCount,
      settledCount: counts.settledCount,
    }),
    runs: runFacts,
    criteria,
    signatures,
    trend,
    coverage: {
      // The suite's roster is not on the run record, so "what exists" cannot be
      // read directly. What CAN be known is what used to run and no longer
      // does — a scenario present in previous runs and absent from this one.
      // That is the actionable half anyway: a test that silently stopped
      // running is invisible in a pass rate and reads as everything passing.
      scenariosInSuite: uniqueScenarios(runFacts),
      scenariosNotRun: findScenariosThatStoppedRunning({ runFacts, priorRuns }),
      neverFailed: buildNeverFailed({ criteria, trend }),
    },
    priorBatches,
    truncation: {
      failingRuns: runFacts.filter((run) => run.category === "failure").length,
      transcriptsIncluded: 0,
      signaturesCovered: 0,
      signaturesTotal: signatures.length,
    },
    // Filled in by the service once transcript selection has run — mirrors
    // `truncation`'s counts above, which are completed the same way.
    transcripts: [],
    stillRunning: counts.inProgressCount + counts.queuedCount > 0,
  };
}

function toRunFact(run: ScenarioRunData): RunFact {
  return {
    runId: run.scenarioRunId,
    scenarioId: run.scenarioId,
    scenarioName: run.name ?? run.scenarioId,
    status: run.status,
    category: categorizeRunStatus(run.status),
    verdict: run.results?.verdict ?? null,
    reasoning: run.results?.reasoning ?? null,
    metCriteria: run.results?.metCriteria ?? [],
    unmetCriteria: run.results?.unmetCriteria ?? [],
    error: run.results?.error ?? null,
    turnCount: run.messages?.length ?? 0,
    durationMs: run.durationInMs,
    cost: run.totalCost ?? null,
  };
}

function sumCost(runs: ScenarioRunData[]): number | null {
  const withCost = runs.filter((run) => run.totalCost != null);
  if (withCost.length === 0) return null;
  return withCost.reduce((sum, run) => sum + (run.totalCost ?? 0), 0);
}

/**
 * Scenarios that ran before and did not run this time.
 *
 * Not the same as "every scenario in the suite", which the run record cannot
 * tell us — but it is the half that goes wrong quietly. A scenario that stops
 * being executed disappears from the pass rate entirely, so its absence reads
 * as success rather than as a gap.
 */
function findScenariosThatStoppedRunning({
  runFacts,
  priorRuns,
}: {
  runFacts: RunFact[];
  priorRuns: ScenarioRunData[];
}): { scenarioId: string; name: string }[] {
  const ranNow = new Set(runFacts.map((fact) => fact.scenarioId));
  const seenBefore = new Map<string, string>();

  for (const run of priorRuns) {
    if (ranNow.has(run.scenarioId)) continue;
    if (!seenBefore.has(run.scenarioId)) {
      seenBefore.set(run.scenarioId, run.name ?? run.scenarioId);
    }
  }

  return [...seenBefore].map(([scenarioId, name]) => ({ scenarioId, name }));
}

function uniqueScenarios(
  runFacts: RunFact[],
): { scenarioId: string; name: string }[] {
  const byId = new Map<string, string>();
  for (const run of runFacts) {
    if (!byId.has(run.scenarioId)) byId.set(run.scenarioId, run.scenarioName);
  }
  return [...byId].map(([scenarioId, name]) => ({ scenarioId, name }));
}

function buildCriterionFacts(runFacts: RunFact[]): CriterionFact[] {
  const facts = new Map<string, CriterionFact>();

  const record = ({
    run,
    text,
    met,
  }: {
    run: RunFact;
    text: string;
    met: boolean;
  }) => {
    const criterionId = criterionIdFor({ scenarioId: run.scenarioId, text });
    const existing = facts.get(criterionId) ?? {
      criterionId,
      scenarioId: run.scenarioId,
      text,
      metCount: 0,
      unmetCount: 0,
      metRunIds: [],
      unmetRunIds: [],
    };
    if (met) {
      existing.metCount++;
      existing.metRunIds.push(run.runId);
    } else {
      existing.unmetCount++;
      existing.unmetRunIds.push(run.runId);
    }
    facts.set(criterionId, existing);
  };

  for (const run of runFacts) {
    for (const text of run.metCriteria) record({ run, text, met: true });
    for (const text of run.unmetCriteria) record({ run, text, met: false });
  }

  return [...facts.values()];
}

/**
 * Groups runs that failed the same way.
 *
 * A run that errored or stalled never reached the judge, so it is grouped by
 * the shape of its error and never mixed with judged failures. Putting them in
 * one list reads as "eleven things wrong with your agent" when four of them are
 * one thing wrong with the test environment.
 */
function buildSignatures({
  runFacts,
  criteria,
}: {
  runFacts: RunFact[];
  criteria: CriterionFact[];
}): FailureSignature[] {
  const criterionIdByRunAndText = new Map(
    criteria.map((fact) => [
      `${fact.scenarioId}\u0000${fact.text}`,
      fact.criterionId,
    ]),
  );
  const signatures = new Map<string, FailureSignature>();

  for (const run of runFacts) {
    if (!didNotPass(run)) continue;

    const kind = signatureKindFor(run);
    const errorShape = run.error ? normalizeErrorShape(run.error) : null;
    const signatureId = signatureIdFor({
      kind,
      unmetCriteria: kind === "judged" ? run.unmetCriteria : [],
      errorShape,
    });

    const existing = signatures.get(signatureId) ?? {
      signatureId,
      kind,
      unmetCriterionIds: [],
      errorShape,
      errorExample: run.error ? truncateError(run.error) : null,
      runIds: [],
      scenarioIds: [],
    };
    addRunToSignature({
      signature: existing,
      run,
      criterionIds:
        kind === "judged"
          ? resolveCriterionIds({ run, criterionIdByRunAndText })
          : [],
    });
    signatures.set(signatureId, existing);
  }

  return [...signatures.values()];
}

/**
 * An error message cut to a readable length.
 *
 * Long enough for a stack-trace-prefixed provider error to still say what went
 * wrong, short enough that one group's error does not become the section.
 */
function truncateError(error: string): string {
  const collapsed = error.replace(/\s+/g, " ").trim();
  return collapsed.length <= 300 ? collapsed : `${collapsed.slice(0, 300)}…`;
}

/** A run that reached a terminal state without passing. */
function didNotPass(run: RunFact): boolean {
  return (
    run.category !== "success" &&
    run.category !== "in_progress" &&
    run.category !== "queued"
  );
}

function resolveCriterionIds({
  run,
  criterionIdByRunAndText,
}: {
  run: RunFact;
  criterionIdByRunAndText: Map<string, string>;
}): string[] {
  return run.unmetCriteria
    .map((text) =>
      criterionIdByRunAndText.get(`${run.scenarioId}\u0000${text}`),
    )
    .filter((id): id is string => id !== undefined);
}

/**
 * Folds one run into its group.
 *
 * Every scenario's own criterion id is kept, so a claim can cite the exact
 * criterion in the exact scenario even though the group spans several.
 */
function addRunToSignature({
  signature,
  run,
  criterionIds,
}: {
  signature: FailureSignature;
  run: RunFact;
  criterionIds: string[];
}): void {
  signature.runIds.push(run.runId);
  for (const criterionId of criterionIds) {
    if (!signature.unmetCriterionIds.includes(criterionId)) {
      signature.unmetCriterionIds.push(criterionId);
    }
  }
  if (!signature.scenarioIds.includes(run.scenarioId)) {
    signature.scenarioIds.push(run.scenarioId);
  }
}

function signatureKindFor(run: RunFact): FailureSignature["kind"] {
  if (run.category === "stalled") return "stalled";
  if (run.category === "cancelled") return "cancelled";
  // A failure with no unmet criteria was never judged against anything — it
  // fell over. Calling it a judged failure would invent a verdict.
  return run.unmetCriteria.length > 0 ? "judged" : "errored";
}

function buildPriorBatches({
  priorRuns,
  priorBatchOrder,
}: {
  priorRuns: ScenarioRunData[];
  priorBatchOrder: string[];
}): PriorBatchFact[] {
  return priorBatchOrder.map((batchRunId) => {
    const batchRuns = priorRuns.filter((run) => run.batchRunId === batchRunId);
    const counts = countRunOutcomes({
      statuses: batchRuns.map((run) => run.status),
    });
    return {
      batchRunId,
      startedAt: batchRuns.reduce(
        (min, run) => Math.min(min, run.timestamp),
        Number.POSITIVE_INFINITY,
      ),
      passRate: passRateFrom({ counts }),
      settled: counts.settledCount,
    };
  });
}

function buildTrend({
  runFacts,
  criteria,
  priorRuns,
  priorBatchOrder,
  batchRunId,
}: {
  runFacts: RunFact[];
  criteria: CriterionFact[];
  priorRuns: ScenarioRunData[];
  priorBatchOrder: string[];
  batchRunId: string;
}): TrendFact[] {
  const historyByCriterion = buildCriterionHistory({
    priorRuns,
    priorBatchOrder,
  });

  return criteria.map((fact) => {
    const currentOutcome: CriterionOutcome =
      fact.unmetCount > 0 ? "unmet" : "met";
    const history: TrendHistoryEntry[] = [
      ...(historyByCriterion.get(fact.criterionId) ?? []),
      { batchRunId, outcome: currentOutcome },
    ];
    const { classification, streakBatches } = classifyTrend({ history });

    return {
      criterionId: fact.criterionId,
      scenarioId: fact.scenarioId,
      text: fact.text,
      classification,
      currentOutcome,
      history,
      streakBatches,
    };
  });
}

/**
 * A criterion's outcome in each previous run, oldest first.
 *
 * A criterion is "unmet" for a batch if it went unmet in ANY run of that batch.
 * Repeats of the same scenario within one run are attempts at the same
 * question, and one failure is enough to say it did not hold.
 */
function buildCriterionHistory({
  priorRuns,
  priorBatchOrder,
}: {
  priorRuns: ScenarioRunData[];
  priorBatchOrder: string[];
}): Map<string, TrendHistoryEntry[]> {
  const history = new Map<string, TrendHistoryEntry[]>();

  for (const batchRunId of priorBatchOrder) {
    const outcomes = outcomesForBatch({
      runs: priorRuns.filter((run) => run.batchRunId === batchRunId),
    });
    for (const [criterionId, outcome] of outcomes) {
      const entries = history.get(criterionId) ?? [];
      entries.push({ batchRunId, outcome });
      history.set(criterionId, entries);
    }
  }

  return history;
}

/**
 * Each criterion's outcome for one batch.
 *
 * Unmet wins: repeats of a scenario within one run are attempts at the same
 * question, and one failure is enough to say it did not hold.
 */
function outcomesForBatch({
  runs,
}: {
  runs: ScenarioRunData[];
}): Map<string, CriterionOutcome> {
  const outcomes = new Map<string, CriterionOutcome>();

  for (const run of runs) {
    for (const text of run.results?.metCriteria ?? []) {
      const id = criterionIdFor({ scenarioId: run.scenarioId, text });
      if (!outcomes.has(id)) outcomes.set(id, "met");
    }
    for (const text of run.results?.unmetCriteria ?? []) {
      outcomes.set(
        criterionIdFor({ scenarioId: run.scenarioId, text }),
        "unmet",
      );
    }
  }

  return outcomes;
}

/**
 * Criteria that have never once failed, here or in any run we can see.
 *
 * The counterpart to a failure list, and the thing a failure list cannot tell
 * you: what is holding, and for how long.
 */
function buildNeverFailed({
  criteria,
  trend,
}: {
  criteria: CriterionFact[];
  trend: TrendFact[];
}): { criterionId: string; text: string; batches: number }[] {
  const trendById = new Map(trend.map((it) => [it.criterionId, it]));

  return criteria
    .filter((fact) => fact.unmetCount === 0)
    .filter((fact) => {
      const history = trendById.get(fact.criterionId)?.history ?? [];
      return history.every((entry) => entry.outcome !== "unmet");
    })
    .map((fact) => ({
      criterionId: fact.criterionId,
      text: fact.text,
      batches: trendById.get(fact.criterionId)?.streakBatches ?? 1,
    }));
}
