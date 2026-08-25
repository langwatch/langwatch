import {
  isNoDataPredicate,
  type GraphTriggerEvaluationResult,
} from "@langwatch/automation-contract";
import { createHash } from "node:crypto";
import type { OpenGraphTriggerSent } from "../repositories/graph-trigger-sent.repository";
import type {
  EvaluationReason,
  GraphSeries,
  GraphTriggerEvaluationDeps,
} from "./graph-trigger-evaluator.types";

export const GRAPH_TRIGGER_MAX_RESULT_ROWS = 10_000;

export function buildGraphSeriesName(series: GraphSeries, index: number): string {
  const aggregation = series.aggregation === "terms" ? "cardinality" : series.aggregation;
  if (series.pipeline) {
    return `${index}/${series.metric}/${aggregation}/${series.pipeline.field}/${series.pipeline.aggregation}`;
  }
  if (series.key) return `${index}/${series.metric}/${aggregation}/${series.key}`;
  return `${index}/${series.metric}/${aggregation}`;
}

export function isTimeseriesResultTooLarge(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 396 || code === "396") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("TOO_MANY_ROWS_OR_BYTES");
}

export function graphAlertFireDigest(input: {
  triggerId: string;
  customGraphId: string;
  previousFireId: string | null;
}): string {
  return createHash("sha256")
    .update(
      `${input.triggerId}:${input.customGraphId}:${input.previousFireId ?? "genesis"}`,
    )
    .digest("hex")
    .slice(0, 16);
}

export function skippedGraphEvaluation(input: {
  triggerId: string;
  projectId: string;
  reason: EvaluationReason;
  detail: string;
}): GraphTriggerEvaluationResult {
  return { ...input, status: "skipped" };
}

export async function resolveGraphIncident(input: {
  deps: GraphTriggerEvaluationDeps;
  openTriggerSent: OpenGraphTriggerSent;
  projectId: string;
  now: Date;
}): Promise<void> {
  await input.deps.triggerSent.markResolvedById({
    id: input.openTriggerSent.id,
    projectId: input.projectId,
    now: input.now,
  });
}

export function noDataDetail(operator: string, threshold: number): string | undefined {
  return isNoDataPredicate({ operator, threshold }) ? "no-data predicate" : undefined;
}
