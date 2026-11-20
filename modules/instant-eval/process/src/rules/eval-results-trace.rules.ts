/**
 * What a trace's drawer shows of its kept results (ADR-189 section 3): per span, question and
 * judged column, the latest judged row, else the latest failed or skipped one; no monitor rows.
 * @see modules/instant-eval/specs/instant-eval-results.feature
 */

import type { InstantEvalTraceResultWire } from "@langwatch/instant-eval-contract";

import type { EvalTraceResult } from "../repositories/eval-results.repository.ts";
import { isLaterEvalResult } from "./eval-results-recall.rules.ts";

/** One drawer cell: the span, the question and the judged column. */
function cellIdOf(result: EvalTraceResult): string {
  return JSON.stringify([result.spanId, result.questionHash, result.judgedColumn]);
}

/** Whether `candidate` stands for its cell over `current`: judged first, then the latest. */
function isPreferredTraceEvalResult({
  candidate,
  current,
}: {
  candidate: EvalTraceResult;
  current: EvalTraceResult;
}): boolean {
  const isCandidateJudged = candidate.status === "judged";
  if (isCandidateJudged !== (current.status === "judged")) return isCandidateJudged;
  return isLaterEvalResult({ candidate, current });
}

/** Newest first; a tie is ordered by its cell, so the list never reshuffles. */
function byJudgedAtThenCell(left: EvalTraceResult, right: EvalTraceResult): number {
  if (left.judgedAt !== right.judgedAt) return right.judgedAt - left.judgedAt;
  const leftCell = cellIdOf(left);
  const rightCell = cellIdOf(right);
  if (leftCell === rightCell) return 0;
  return leftCell < rightCell ? -1 : 1;
}

/** The result each cell of one trace shows, newest first, monitor rows left out. */
export function latestTraceEvalResults(
  rows: readonly EvalTraceResult[],
): readonly EvalTraceResult[] {
  const byCell = new Map<string, EvalTraceResult>();
  for (const row of rows) {
    if (row.source === "monitor") continue;
    const cellId = cellIdOf(row);
    const current = byCell.get(cellId);
    if (!current || isPreferredTraceEvalResult({ candidate: row, current })) {
      byCell.set(cellId, row);
    }
  }
  return [...byCell.values()].toSorted(byJudgedAtThenCell);
}

/** A kept result as the drawer receives it; a monitor's is never one. */
export function toInstantEvalTraceResultWire(
  result: EvalTraceResult,
): readonly InstantEvalTraceResultWire[] {
  if (result.source === "monitor") return [];
  return [
    {
      spanId: result.spanId,
      judgedColumn: result.judgedColumn,
      question: result.question,
      kind: result.kind,
      status: result.status,
      probability: result.probability,
      score: result.score,
      label: result.label,
      judgeModel: result.judgeModel,
      judgedAt: result.judgedAt,
      source: result.source,
      sourceId: result.sourceId,
    },
  ];
}
