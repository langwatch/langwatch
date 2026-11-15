/**
 * One query per trace filter kind (rp-trace-filter-compiler census K0-K15), the window and the
 * Instant Eval runs they compile under; shared by the unit suite and the 26.8 parity suite.
 */
import type { ResolvedInstantEvalRun } from "@langwatch/trace-contract";

import {
  TRACE_SUMMARY_CATEGORICAL_EXPRESSIONS,
  TRACE_SUMMARY_RANGE_EXPRESSIONS,
} from "../../../../facet/repositories/clickhouse/clickhouse.trace-facet-expressions.mapper.ts";

export const timeRange = { from: 1_700_000_000_000, to: 1_700_000_600_000 };

export const RUNS: readonly ResolvedInstantEvalRun[] = [
  {
    runId: "run_t",
    question: "is it kind",
    target: "traces",
    writtenFrom: timeRange.from,
    writtenUntil: timeRange.to,
  },
  {
    runId: "run_c",
    question: "was it solved",
    target: "threads",
    writtenFrom: timeRange.from,
    writtenUntil: timeRange.to,
  },
] as readonly ResolvedInstantEvalRun[];

/** K16, the hidden origins, is `findHiddenOriginFilters`; it is not a query. */
export const FILTER_KINDS: readonly (readonly [kind: string, query: string])[] = [
  ["K0 boolean group", "(status:error OR cost:>1) AND NOT model:x"],
  ["K0 negated group", "NOT (status:error AND service:api)"],
  ...Object.keys(TRACE_SUMMARY_CATEGORICAL_EXPRESSIONS).map(
    (key) => [`K1 ${key}`, `${key}:"v 1"`] as const,
  ),
  ["K2 range", "cost:[0.1 TO 0.5]"],
  ...Object.keys(TRACE_SUMMARY_RANGE_EXPRESSIONS).map(
    (key) => [`K2 ${key}`, `${key}:>=3`] as const,
  ),
  ["K2 tokens below", "tokens:<12"],
  ["K3 trace id", "trace:abc"],
  ["K3 trace id wildcard", "traceId:ab*"],
  ...["error", "annotation", "conversation", "user", "customer", "topic", "subtopic", "label"]
    .concat(["model", "service", "traceName", "rootSpanType", "attribute.k1", "trace.attribute.k1"])
    .map((value) => [`K4 has:${value}`, `has:${value}`] as const),
  ["K4 none", "none:topic"],
  ["K5 prompt", "prompt:p1"],
  ["K6 scenario run", "scenarioRun:sr1"],
  ["K7 model", "model:gpt-5-mini"],
  ["K7 model wildcard", "model:gpt*"],
  ["K8 label", "label:urgent"],
  ["K9 trace attribute", "trace.attribute.k1:v1"],
  ["K9 legacy attribute", "attribute.k1:v1"],
  ["K10 free text", "hello"],
  ["K10 negated free text", "NOT hello"],
  ["K11 event", "event:click"],
  ["K11 feedback", "has:feedback"],
  ["K11 span id", "spanId:s1"],
  ["K11 span id wildcard", "spanId:s*"],
  ["K11 event attribute", "event.attribute.k1:v1"],
  ["K11 span attribute", "span.attribute.k1:v1"],
  ["K11 span facets", "spanType:llm AND spanName:chat AND NOT spanStatus:error"],
  ["K12 evaluator name", 'eval:"faithfulness"'],
  ["K12 has eval", "has:eval"],
  ["K12 none eval", "none:eval"],
  ["K12 evaluator", "evaluator:ev1"],
  ["K12 evaluation facets", "evaluatorStatus:processed AND evaluatorVerdict:pass"],
  ["K12 evaluation score and label", "evaluatorScore:>0.5 OR evaluatorLabel:good"],
  ["K12 old verdict name", "NOT evaluatorPassed:fail"],
  [
    "K13 evaluation scope",
    "evaluator:ev1 AND evaluatorVerdict:pass AND evaluatorVerdict:fail AND NOT evaluatorLabel:bad AND evaluatorScore:>0.3 AND cost:>1",
  ],
  ["K13 scope without results", "evaluator:ev1 AND NOT evaluatorLabel:bad"],
  ["K14 scenario", "scenario:sc1"],
  ["K14 scenario set and batch", "scenarioSet:set1 OR scenarioBatch:b1"],
  ["K14 scenario verdict", "scenarioVerdict:success"],
  ["K14 scenario status", "NOT scenarioStatus:running"],
  ["K15 judged traces", 'eval.trace:"is it kind"'],
  ["K15 judged conversations", 'NOT eval:"was it solved"'],
  ["K15 forced without a run", 'eval.llm:"nobody asked"'],
  ["K15 negated forced without a run", 'NOT eval.conversation:"nobody asked"'],
];
