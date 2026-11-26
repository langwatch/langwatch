// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** What each owner's event contributes to a week: bounded facts, ids and numbers only. */
import {
  type MetricFactsContribution,
  normalizeMetricName,
  type SpanFactsContribution,
} from "@langwatch/coding-agent-contract";
import type { EvaluationLifecycleCompletedEventData } from "@langwatch/evaluation-contract";
import type { SimulationRunFinishedEventData } from "@langwatch/scenario-contract";

import type { ProjectFact, UserActivity } from "../eventing/digest-activity.events.ts";

type Outcome = "passed" | "failed" | "other";

const numberOf = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const outcomeOf = ({ passed, failed }: { passed: boolean; failed: boolean }): Outcome => {
  if (passed) return "passed";
  if (failed) return "failed";
  return "other";
};

export function evaluationFact(data: EvaluationLifecycleCompletedEventData): ProjectFact {
  const outcome = outcomeOf({ passed: data.passed === true, failed: data.passed === false });
  return { kind: "evaluation", evaluatorType: data.evaluatorType ?? null, outcome };
}

export function scenarioFact(data: SimulationRunFinishedEventData): ProjectFact {
  const verdict = data.results?.verdict;
  const outcome = outcomeOf({ passed: verdict === "success", failed: verdict === "failure" });
  return { kind: "scenario", scenarioId: data.scenarioId ?? null, outcome };
}

/** The repository a coding-agent fact was stamped with, `owner/name`, when it carried one. */
export function extractRepository(
  facts: Pick<SpanFactsContribution, "repositoryOwner" | "repositoryName">,
): string | undefined {
  if (!facts.repositoryName) return undefined;
  return facts.repositoryOwner
    ? `${facts.repositoryOwner}/${facts.repositoryName}`
    : facts.repositoryName;
}

/** A metric series in the contract's normalised name, or none for a metric digest does not sum. */
export function metricSeries(data: MetricFactsContribution): UserActivity["series"] {
  const metric = normalizeMetricName(data.metricName);
  if (metric === null) return null;
  const type = data.attributes.type;
  return {
    seriesId: data.seriesId,
    metric,
    type: typeof type === "string" ? type : null,
    value: numberOf(data.value),
  };
}
