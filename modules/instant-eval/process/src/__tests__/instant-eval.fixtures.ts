/**
 * The two rows every reading test needs, built field by field so a test only
 * writes the fields it is about.
 */

import { Temporal } from "@langwatch/time";

import type { InstantEvalJudgment } from "../repositories/instant-eval-judgments.repository.ts";
import type { InstantEvalRunRow } from "../repositories/instant-eval-run.repository.ts";

export const AT = Temporal.Instant.from("2026-09-18T10:00:00Z");

export function instantEvalRunRow(overrides: Partial<InstantEvalRunRow> = {}): InstantEvalRunRow {
  return {
    id: "run-1",
    projectId: "project-1",
    name: "nightly",
    sql: "SELECT TraceId FROM analytics.traces",
    parameters: {},
    questions: [],
    plan: [],
    rowLimit: 1_000,
    status: "RUNNING",
    total: 120,
    progress: 40,
    matched: 12,
    matchedByQuestion: { annoyed: 12 },
    failed: 1,
    skipped: 2,
    tokens: 4_200,
    costUsd: 0.000_176_4,
    priceUsd: 0.000_229_3,
    error: null,
    createdAt: AT,
    updatedAt: AT,
    startedAt: AT,
    finishedAt: null,
    occurredAt: null,
    acceptedAt: null,
    lastEventId: null,
    projectionVersion: null,
    ...overrides,
  };
}

export function instantEvalJudgment(
  overrides: Partial<InstantEvalJudgment> = {},
): InstantEvalJudgment {
  return {
    traceId: "trace-1",
    questionId: "annoyed",
    threadId: "thread-1",
    spanId: "",
    kind: "boolean",
    status: "judged",
    passed: true,
    score: null,
    label: null,
    probability: 0.96,
    probabilities: null,
    error: null,
    occurredAt: AT.toString(),
    ...overrides,
  };
}
