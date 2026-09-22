/**
 * The stored run as a caller reads it: `status` is published lowercase,
 * `rowLimit` as `limit`, and the hydration plan not at all.
 */

import {
  type InstantEvalEstimateWire,
  type InstantEvalJudgmentWire,
  type InstantEvalRunWire,
  instantEvalStoredParametersSchema,
} from "@langwatch/instant-eval-contract";
import { z } from "zod";

import type { InstantEvalJudgment } from "../repositories/instant-eval-judgments.repository.ts";
import type { InstantEvalRunRow } from "../repositories/instant-eval-run.repository.ts";
import { readInstantEvalRunQuestions } from "./instant-eval-run-questions.rules.ts";
import { publishedInstantEvalStatus } from "./instant-eval-run-status.rules.ts";

/** One judgement, as a caller reads it. */
export function toInstantEvalJudgmentWire(judgment: InstantEvalJudgment): InstantEvalJudgmentWire {
  return {
    traceId: judgment.traceId,
    questionId: judgment.questionId,
    threadId: judgment.threadId,
    spanId: judgment.spanId,
    kind: judgment.kind,
    status: judgment.status,
    passed: judgment.passed,
    score: judgment.score,
    label: judgment.label,
    probability: judgment.probability,
    probabilities: judgment.probabilities ?? null,
    error: judgment.error,
    occurredAt: judgment.occurredAt,
  };
}

/** One run, as a caller reads it. */
/** An estimate as the wire carries it: the price, never our own cost. */
export function toInstantEvalEstimateWire(estimate: {
  rows: number;
  isRowsCapped: boolean;
  avgTokens: number;
  totalTokens: number;
  requests: number;
  priceUsd: number;
  freeBudgetRemainingUsd?: number;
}): InstantEvalEstimateWire {
  return {
    rows: estimate.rows,
    isRowsCapped: estimate.isRowsCapped,
    avgTokens: estimate.avgTokens,
    totalTokens: estimate.totalTokens,
    requests: estimate.requests,
    priceUsd: estimate.priceUsd,
    ...(estimate.freeBudgetRemainingUsd === undefined
      ? {}
      : { freeBudgetRemainingUsd: estimate.freeBudgetRemainingUsd }),
  };
}

export function toInstantEvalRunWire(row: InstantEvalRunRow): InstantEvalRunWire {
  return {
    id: row.id,
    name: row.name,
    sql: row.sql,
    parameters: parametersOf(row.parameters),
    questions: readInstantEvalRunQuestions(row.questions).map((question) => ({
      id: question.id,
      function: question.function,
      kind: question.kind,
      reads: question.reads,
      threshold: question.threshold ?? null,
    })),
    limit: row.rowLimit,
    status: publishedInstantEvalStatus(row.status),
    total: row.total,
    progress: row.progress,
    matched: row.matched,
    matchedByQuestion: matchedByQuestionOf(row.matchedByQuestion),
    failed: row.failed,
    skipped: row.skipped,
    tokens: row.tokens,
    priceUsd: row.priceUsd,
    error: row.error,
    createdAt: row.createdAt.toString(),
    updatedAt: row.updatedAt.toString(),
    startedAt: row.startedAt?.toString() ?? null,
    finishedAt: row.finishedAt?.toString() ?? null,
  };
}

/** The bound values, read back defensively: the column is JSON a run wrote. */
function parametersOf(stored: unknown): InstantEvalRunWire["parameters"] {
  const parsed = instantEvalStoredParametersSchema.safeParse(stored);
  return parsed.success ? parsed.data : {};
}

function matchedByQuestionOf(stored: unknown): InstantEvalRunWire["matchedByQuestion"] {
  const parsed = z.record(z.string(), z.number()).safeParse(stored);
  return parsed.success ? parsed.data : {};
}
