/**
 * The facet registry's SQL `expression`s as builder expressions, one per expression facet the
 * filter compiles; the unit suite holds each to the registry's text so the two cannot drift.
 */
import { cond, type Expression, fn, param } from "@langwatch/clickhouse-client/builder";
import {
  DEFAULT_TRACE_ORIGIN,
  RESERVED_CACHE_CREATION_TOKENS,
  RESERVED_CACHE_READ_TOKENS,
} from "@langwatch/trace-contract";

import { evaluationRuns } from "../../../../repositories/clickhouse/clickhouse.evaluation-runs.table.ts";
import { storedSpans } from "../../../../repositories/clickhouse/clickhouse.stored-spans.table.ts";
import { traceSummaries } from "../../../../repositories/clickhouse/clickhouse.trace-summaries.table.ts";

const ts = traceSummaries;
const runs = evaluationRuns;

const attribute = (key: string) => fn.mapGet(ts.Attributes, key);
const label = (value: string) => param.string(value);
const origin = attribute("langwatch.origin");
const spanStatusCode = fn.ifNull(storedSpans.StatusCode, 0);

type Summary<V> = Expression<V | null, "trace_summaries">;

type SummaryCategoricalKey =
  | "status"
  | "origin"
  | "service"
  | "user"
  | "conversation"
  | "customer"
  | "topic"
  | "subtopic"
  | "traceName"
  | "rootSpanType"
  | "guardrail"
  | "annotation"
  | "containsAi"
  | "errorMessage"
  | "tokensEstimated"
  | "selectedPrompt"
  | "lastUsedPrompt";

type SummaryRangeKey =
  | "promptVersion"
  | "cost"
  | "duration"
  | "tokens"
  | "ttft"
  | "ttlt"
  | "promptTokens"
  | "completionTokens"
  | "tokensPerSecond"
  | "spans"
  | "size";

/** `trace_summaries` categorical facets, as the registry and the contract's origin write them. */
export const TRACE_SUMMARY_CATEGORICAL_EXPRESSIONS: Readonly<
  Record<SummaryCategoricalKey, Summary<string>>
> = {
  status: fn.if(
    cond.eq(ts.ContainsErrorStatus, true),
    label("error"),
    fn.if(cond.eq(ts.BlockedByGuardrail, true), label("warning"), "ok"),
  ),
  origin: fn.if(cond.eq(origin, ""), label(DEFAULT_TRACE_ORIGIN), origin),
  service: attribute("service.name"),
  user: attribute("langwatch.user_id"),
  conversation: attribute("gen_ai.conversation.id"),
  customer: attribute("langwatch.customer_id"),
  topic: ts.TopicId,
  subtopic: ts.SubTopicId,
  traceName: ts.TraceName,
  rootSpanType: ts.RootSpanType,
  guardrail: fn.if(ts.BlockedByGuardrail, label("blocked"), "allowed"),
  annotation: fn.if(fn.ifNull(ts.HasAnnotation, false), label("annotated"), "unannotated"),
  containsAi: fn.if(ts.ContainsAi, label("yes"), "no"),
  errorMessage: ts.ErrorMessage,
  tokensEstimated: fn.if(ts.TokensEstimated, label("estimated"), "actual"),
  selectedPrompt: ts.SelectedPromptId,
  lastUsedPrompt: ts.LastUsedPromptId,
};

/** `trace_summaries` range facets; `tokens` is NULL without both counts, as main's filter sum. */
export const TRACE_SUMMARY_RANGE_EXPRESSIONS: Readonly<Record<SummaryRangeKey, Summary<number>>> = {
  promptVersion: ts.LastUsedPromptVersionNumber,
  cost: ts.TotalCost,
  duration: ts.TotalDurationMs,
  tokens: fn.plus(
    fn.plus(
      fn.plus(ts.TotalPromptTokenCount, ts.TotalCompletionTokenCount),
      fn.toUInt64OrZero(attribute(RESERVED_CACHE_READ_TOKENS)),
    ),
    fn.toUInt64OrZero(attribute(RESERVED_CACHE_CREATION_TOKENS)),
  ),
  ttft: ts.TimeToFirstTokenMs,
  ttlt: ts.TimeToLastTokenMs,
  promptTokens: ts.TotalPromptTokenCount,
  completionTokens: ts.TotalCompletionTokenCount,
  tokensPerSecond: ts.TokensPerSecond,
  spans: ts.SpanCount,
  size: ts._size_bytes,
};

/** `evaluation_runs` facets; the verdict's error and skipped arms win, as in the registry. */
export const EVALUATION_RUN_EXPRESSIONS: {
  readonly evaluatorStatus: Expression<string | null, "evaluation_runs">;
  readonly evaluatorVerdict: Expression<string | null, "evaluation_runs">;
  readonly evaluatorScore: Expression<number | null, "evaluation_runs">;
  readonly evaluatorLabel: Expression<string | null, "evaluation_runs">;
} = {
  evaluatorStatus: runs.Status,
  evaluatorVerdict: fn.multiIf(
    [
      [cond.eq(runs.Status, "error"), label("error")],
      [cond.eq(runs.Status, "skipped"), label("skipped")],
      [cond.eq(runs.Passed, 1), label("pass")],
      [cond.eq(runs.Passed, 0), label("fail")],
    ],
    label("unknown"),
  ),
  evaluatorScore: runs.Score,
  evaluatorLabel: runs.Label,
};

/** `stored_spans` categorical facets. */
export const STORED_SPAN_EXPRESSIONS: Readonly<
  Record<"spanType" | "spanName" | "spanStatus", Expression<string | null, "stored_spans">>
> = {
  spanType: fn.mapGet(storedSpans.SpanAttributes, "langwatch.span.type"),
  spanName: storedSpans.SpanName,
  spanStatus: fn.if(
    cond.eq(spanStatusCode, 2),
    label("error"),
    fn.if(cond.eq(spanStatusCode, 1), label("ok"), "unset"),
  ),
};
