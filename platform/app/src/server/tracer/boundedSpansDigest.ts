import { cutToEstimatedTokensAtLineBreak } from "~/shared/traces/tokenBudget";
import { langwatchSpanToReadableSpan } from "./spanToReadableSpan";
import type { Span } from "./types";

/**
 * The LLM-readable trace digest, under a token budget.
 *
 * `formatSpansDigest` renders the whole trace, which is right for a person
 * reading it and wrong for anything that sends it to a model: a coding-agent
 * trace runs to hundreds of thousands of tokens. The budget rules are the
 * judge's own, applied here rather than left to the caller:
 *
 *   1. the full digest, when it fits;
 *   2. otherwise the structure-only skeleton plus as many fully expanded spans
 *      as fit, taken in the order a reader would want them: the spans that
 *      errored, then the model calls, then the slowest;
 *   3. otherwise the skeleton alone, cut to the budget.
 *
 * The estimate is UTF-8 bytes over four, the same rule the scenario judge
 * uses, so a digest that fits here fits there.
 */
export interface BoundedSpansDigest {
  text: string;
  /** Whether anything was left out to fit the budget. */
  isTruncated: boolean;
  estimatedTokens: number;
}

export async function formatSpansDigestBounded({
  spans,
  maxTokens,
}: {
  spans: Span[];
  /** Defaults to the scenario judge's own threshold. */
  maxTokens?: number;
}): Promise<BoundedSpansDigest> {
  const {
    judgeSpanDigestFormatter,
    estimateTokens,
    expandTrace,
    DEFAULT_TOKEN_THRESHOLD,
  } = await import("@langwatch/scenario");
  const budget = maxTokens ?? DEFAULT_TOKEN_THRESHOLD;
  const readableSpans = spans.map(langwatchSpanToReadableSpan);

  const full = judgeSpanDigestFormatter.format(readableSpans);
  const fullTokens = estimateTokens(full);
  if (fullTokens <= budget) {
    return { text: full, isTruncated: false, estimatedTokens: fullTokens };
  }

  const structure = judgeSpanDigestFormatter.formatStructureOnly(readableSpans);
  const structureTokens = estimateTokens(structure);
  if (structureTokens > budget) {
    // One span per line, so the cut lands on a line break: half a tree line
    // names a span that does not exist. The tail goes, which is why the
    // expansion ranking below never gets a chance on a trace this large.
    const text = cutToEstimatedTokensAtLineBreak({
      text: structure,
      maxTokens: budget,
    });
    return { text, isTruncated: true, estimatedTokens: estimateTokens(text) };
  }

  let text = structure;
  const expanded: string[] = [];
  for (const span of rankSpansForExpansion(spans)) {
    const candidateIds = [...expanded, span.span_id];
    const candidate = `${structure}\n\n${expandTrace(readableSpans, candidateIds)}`;
    // A span that does not fit is skipped rather than ending the walk: a
    // cheaper one further down the ranking still earns its place.
    if (estimateTokens(candidate) > budget) continue;
    expanded.push(span.span_id);
    text = candidate;
  }

  return { text, isTruncated: true, estimatedTokens: estimateTokens(text) };
}

/**
 * The order spans are worth expanding in: what failed, then what the model
 * did, then what took the longest. Ties keep the trace's own order so the
 * output of two identical traces is identical.
 */
export function rankSpansForExpansion(spans: Span[]): Span[] {
  return spans
    .map((span, index) => ({ span, index }))
    .sort((a, b) => {
      const priority = spanPriority(a.span) - spanPriority(b.span);
      if (priority !== 0) return priority;
      const duration = spanDurationMs(b.span) - spanDurationMs(a.span);
      if (duration !== 0) return duration;
      return a.index - b.index;
    })
    .map(({ span }) => span);
}

function spanPriority(span: Span): number {
  if (span.error) return 0;
  if (span.type === "llm") return 1;
  return 2;
}

function spanDurationMs(span: Span): number {
  return span.timestamps.finished_at - span.timestamps.started_at;
}
