// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** What each owner's event contributes to a week: bounded facts, ids and numbers only. */
import {
  type MetricFactsContribution,
  normalizeMetricName,
  type SpanFactsContribution,
} from "@langwatch/coding-agent-contract";
import type { EvaluationLifecycleCompletedEventData } from "@langwatch/evaluation-contract";
import type { SimulationRunFinishedEventData } from "@langwatch/scenario-contract";
import type { SuiteRunItemCompletedEventData } from "@langwatch/suite-contract";
import { type NormalizedSpan, NormalizedStatusCode } from "@langwatch/trace-contract";

import type { ProjectFact, UserActivity } from "../eventing/digest-activity.events.ts";

type Outcome = "passed" | "failed" | "other";

const numberOf = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const textOf = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

export function spanFact(span: NormalizedSpan): ProjectFact {
  const attributes = span.spanAttributes;
  return {
    kind: "span",
    root: span.parentSpanId === null,
    error: span.statusCode === NormalizedStatusCode.ERROR,
    tokens:
      numberOf(attributes["gen_ai.usage.input_tokens"]) +
      numberOf(attributes["gen_ai.usage.output_tokens"]),
    costUsd: numberOf(span.cost),
    durationMs: numberOf(span.durationMs),
    model: textOf(attributes["gen_ai.response.model"]) ?? textOf(attributes["gen_ai.request.model"]),
  };
}

export function evaluationFact(data: EvaluationLifecycleCompletedEventData): ProjectFact {
  const outcome: Outcome = data.passed === true ? "passed" : data.passed === false ? "failed" : "other";
  return { kind: "evaluation", evaluatorType: data.evaluatorType ?? null, outcome };
}

export function scenarioFact(data: SimulationRunFinishedEventData): ProjectFact {
  const verdict = data.results?.verdict;
  const outcome: Outcome =
    verdict === "success" ? "passed" : verdict === "failure" ? "failed" : "other";
  return { kind: "scenario", scenarioId: data.scenarioId ?? null, outcome };
}

const SUITE_PASSED = new Set(["success", "passed", "pass"]);
const SUITE_FAILED = new Set(["failure", "failed", "fail", "error"]);

export function suiteItemFact(data: SuiteRunItemCompletedEventData): ProjectFact {
  const verdict = (data.verdict ?? data.status).toLowerCase();
  const outcome: Outcome = SUITE_PASSED.has(verdict)
    ? "passed"
    : SUITE_FAILED.has(verdict)
      ? "failed"
      : "other";
  return { kind: "suiteItem", outcome };
}

/** The repository a coding-agent fact was stamped with, `owner/name`, when it carried one. */
export function repositoryOf(
  facts: Pick<SpanFactsContribution, "repositoryOwner" | "repositoryName">,
): string | null {
  if (!facts.repositoryName) return null;
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
