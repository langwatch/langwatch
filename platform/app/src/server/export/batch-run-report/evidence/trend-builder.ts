/**
 * What changed between this run and the ones before it.
 *
 * Every classification here is computed from criterion outcomes across
 * batches, with no model involved, which is what lets the trend render at
 * every tier.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import {
  countRunOutcomes,
  passRateFrom,
} from "~/shared/scenario-run-report/run-outcome-summary";
import type {
  CriterionFact,
  CriterionOutcome,
  PriorBatchFact,
  RunFact,
  TrendFact,
} from "../report.types";
import { earliestTimestamp } from "./evidence-builder";
import { criterionIdFor } from "./fingerprint";
import { classifyTrend, type TrendHistoryEntry } from "./trend";

export function buildPriorBatches({
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
      startedAt: earliestTimestamp(batchRuns),
      passRate: passRateFrom({ counts }),
      settled: counts.settledCount,
    };
  });
}

export function buildTrend({
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
export function buildNeverFailed({
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
