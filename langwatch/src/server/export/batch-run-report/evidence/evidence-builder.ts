import { countRunOutcomes } from "~/server/scenarios/run-outcome-summary";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { categorizeRunStatus } from "~/server/scenarios/scenario-run-category";
import type { CriterionFact, ReportEvidence, RunFact } from "../report.types";
import { buildPassRateFact } from "./confidence";
import { criterionIdFor } from "./fingerprint";
import { buildSignatures } from "./signature-builder";
import {
  buildNeverFailed,
  buildPriorBatches,
  buildTrend,
} from "./trend-builder";

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
      startedAt: earliestTimestamp(runs),
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
    isStillRunning: counts.inProgressCount + counts.queuedCount > 0,
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
 * When the earliest of these runs started, or 0 when there are none.
 *
 * A `Math.min` fold seeded with `POSITIVE_INFINITY` returns `Infinity` for an
 * empty list, and `Infinity` travels as a timestamp: it renders as an invalid
 * date and compares as later than every real run, which silently inverts a
 * trend. The batch read is guarded against empty, but the per-batch history
 * grouping is not, so this is the shared floor for both.
 */
export function earliestTimestamp(runs: { timestamp: number }[]): number {
  if (runs.length === 0) return 0;
  return runs.reduce((min, run) => Math.min(min, run.timestamp), Infinity);
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
    isMet,
  }: {
    run: RunFact;
    text: string;
    isMet: boolean;
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
    if (isMet) {
      existing.metCount++;
      existing.metRunIds.push(run.runId);
    } else {
      existing.unmetCount++;
      existing.unmetRunIds.push(run.runId);
    }
    facts.set(criterionId, existing);
  };

  for (const run of runFacts) {
    for (const text of run.metCriteria) record({ run, text, isMet: true });
    for (const text of run.unmetCriteria) record({ run, text, isMet: false });
  }

  return [...facts.values()];
}
