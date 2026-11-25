import { printSummary } from "./printSummary.ts";
import type { BatchEntry, ExperimentEvaluationResult } from "./types.ts";

// Slim projections retained across the lifetime of an Experiment for
// printSummary() — deliberately excludes large fields (inputs, tracebacks,
// outputs) so running thousands of items doesn't unbound memory.
export type SummaryEvaluation = Pick<
  ExperimentEvaluationResult,
  "name" | "evaluator" | "status" | "passed" | "score" | "cost" | "target_id"
>;
export type SummaryEntry = Pick<BatchEntry, "duration" | "error" | "cost" | "target_id">;

type EvaluatorTally = { passed: number; failed: number; scoreSum: number; scoreCount: number };
type TargetTally = {
  passed: number;
  failed: number;
  latencySum: number;
  latencyCount: number;
  cost: number;
};

/** Crashed evaluators (status "error") count as failures so CI never passes on a crash. */
function tallyEvaluators(evaluations: readonly SummaryEvaluation[]): {
  evaluators: Map<string, EvaluatorTally>;
  totalPassed: number;
  totalFailed: number;
  evaluationCost: number;
} {
  const evaluators = new Map<string, EvaluatorTally>();
  let totalPassed = 0;
  let totalFailed = 0;
  let evaluationCost = 0;
  for (const e of evaluations) {
    const name = e.name ?? e.evaluator ?? "unknown";
    const stats = evaluators.get(name) ?? { passed: 0, failed: 0, scoreSum: 0, scoreCount: 0 };
    evaluators.set(name, stats);
    if (e.status === "error" || e.passed === false) {
      stats.failed += 1;
      totalFailed += 1;
    } else if (e.passed === true) {
      stats.passed += 1;
      totalPassed += 1;
    }
    if (typeof e.score === "number") {
      stats.scoreSum += e.score;
      stats.scoreCount += 1;
    }
    if (typeof e.cost === "number") evaluationCost += e.cost;
  }
  return { evaluators, totalPassed, totalFailed, evaluationCost };
}

function targetTallyOf({
  targets,
  tid,
}: {
  targets: Map<string, TargetTally>;
  tid: string;
}): TargetTally {
  const stats = targets.get(tid) ?? {
    passed: 0,
    failed: 0,
    latencySum: 0,
    latencyCount: 0,
    cost: 0,
  };
  targets.set(tid, stats);
  return stats;
}

function targetSummaries(targets: Map<string, TargetTally>) {
  return Array.from(targets.entries()).map(([targetId, s]) => ({
    targetId,
    name: targetId,
    passed: s.passed,
    failed: s.failed,
    avgLatency: s.latencyCount > 0 ? s.latencySum / s.latencyCount : 0,
    totalCost: s.cost,
  }));
}

function evaluatorSummaries(evaluators: Map<string, EvaluatorTally>) {
  return Array.from(evaluators.entries()).map(([name, s]) => ({
    evaluatorId: name,
    name,
    passed: s.passed,
    failed: s.failed,
    passRate: s.passed + s.failed > 0 ? (s.passed / (s.passed + s.failed)) * 100 : 0,
    avgScore: s.scoreCount > 0 ? s.scoreSum / s.scoreCount : undefined,
  }));
}

function tallyEntryTargets({
  targets,
  entries,
}: {
  targets: Map<string, TargetTally>;
  entries: readonly SummaryEntry[];
}): void {
  for (const entry of entries) {
    if (!entry.target_id) continue;
    const stats = targetTallyOf({ targets, tid: entry.target_id });
    if (typeof entry.duration === "number") {
      stats.latencySum += entry.duration;
      stats.latencyCount += 1;
    }
    if (typeof entry.cost === "number") stats.cost += entry.cost;
  }
}

function tallyEvaluationTargets({
  targets,
  evaluations,
}: {
  targets: Map<string, TargetTally>;
  evaluations: readonly SummaryEvaluation[];
}): void {
  for (const e of evaluations) {
    if (!e.target_id) continue;
    const stats = targetTallyOf({ targets, tid: e.target_id });
    if (e.status === "error" || e.passed === false) stats.failed += 1;
    else if (e.passed === true) stats.passed += 1;
    if (typeof e.cost === "number") stats.cost += e.cost;
  }
}

/** Evaluations seed targets too: one logged with an explicit target_id may have no entry row. */
function tallyTargets({
  entries,
  evaluations,
}: {
  entries: readonly SummaryEntry[];
  evaluations: readonly SummaryEvaluation[];
}): Map<string, TargetTally> {
  const targets = new Map<string, TargetTally>();
  tallyEntryTargets({ targets, entries });
  tallyEvaluationTargets({ targets, evaluations });
  return targets;
}

/** Prints the CI summary of an SDK-defined experiment run and exits 1 on failure when asked. */
export function printExperimentSummary({
  runId,
  runUrl,
  createdAtMs,
  evaluations,
  entries,
  exitOnFailure,
}: {
  runId: string;
  runUrl: string;
  createdAtMs: number;
  evaluations: readonly SummaryEvaluation[];
  entries: readonly SummaryEntry[];
  exitOnFailure: boolean;
}): void {
  const { evaluators, totalPassed, totalFailed, evaluationCost } = tallyEvaluators(evaluations);
  let totalCost = evaluationCost;
  const targets = tallyTargets({
    entries: entries,
    evaluations: evaluations,
  });

  const total = totalPassed + totalFailed;
  const passRate = total > 0 ? (totalPassed / total) * 100 : 0;

  // Wall-clock duration from init — summing entry durations over-counts
  // under concurrent withTarget() calls (each target produces its own entry).
  const duration = Math.max(0, Date.now() - createdAtMs);

  // Count entries whose target/loop execution errored out — distinct from
  // evaluator failures but must also trigger CI exit.
  let failedCells = 0;
  for (const entry of entries) {
    if (typeof entry.cost === "number") totalCost += entry.cost;
    if (entry.error) failedCells += 1;
  }

  const hasFailures = totalFailed > 0 || failedCells > 0;

  printSummary({
    runId: runId,
    status: hasFailures ? "failed" : "completed",
    passed: totalPassed,
    failed: totalFailed,
    passRate,
    duration,
    runUrl,
    summary: {
      runId: runId,
      totalCells: entries.length || total,
      completedCells: Math.max(0, (entries.length || total) - failedCells),
      failedCells,
      duration,
      runUrl: runUrl,
      totalPassed,
      totalFailed,
      passRate,
      totalCost,
      targets: targetSummaries(targets),
      evaluators: evaluatorSummaries(evaluators),
    },
  });

  if (exitOnFailure && hasFailures) {
    process.exit(1);
  }
}
