/**
 * The question-first picker's contents: questions grouped by the shape of the
 * answer, each carrying the prompt Langy is asked with. v1 adds no block for a
 * question; Langy answers from LangWatchQL over the board's period and grain.
 */

/** The icon a question row shows; the picker maps each name to a glyph. */
export type BlockQuestionIcon =
  | "gauge"
  | "activity"
  | "trendingDown"
  | "coins"
  | "messageSquare"
  | "alertTriangle"
  | "xCircle"
  | "flaskConical"
  | "gitCompare"
  | "dollarSign"
  | "cpu"
  | "helpCircle"
  | "scale";

export interface BlockQuestion {
  readonly id: string;
  readonly question: string;
  readonly why: string;
  readonly icon: BlockQuestionIcon;
  /** What Langy is asked: where the answer lives, over which window, in which shape. */
  readonly prompt: string;
}

export interface BlockQuestionSection {
  readonly id: string;
  readonly title: string;
  readonly why: string;
  /** A short, user-facing line for what a board made from this section shows. */
  readonly summary: string;
  /** A design-system colour palette tinting the section title and its icons. */
  readonly palette: string;
  readonly questions: readonly BlockQuestion[];
}

/** Every prompt ends here, so an answer is never invented or silent about an empty period. */
const EVIDENCE =
  "Quote the real numbers from the query result. If a query returns no rows, " +
  "say plainly that there is no data for the dashboard period rather than guessing.";

const WINDOW = "over the dashboard period, bucketed at the dashboard grain";

export const BLOCK_QUESTION_SECTIONS: readonly BlockQuestionSection[] = [
  {
    id: "happen",
    title: "What happened?",
    why: "The event is discrete; you need the count as much as the trend.",
    summary: "Traffic, success rate, latency and cost at a glance",
    palette: "purple",
    questions: [
      {
        id: "overall",
        question: "How is my agent doing overall?",
        why: "Traffic, success rate, latency and cost against the period before.",
        icon: "gauge",
        prompt:
          "How is my agent doing overall? Query the LangWatchQL view trace_metrics over the " +
          "dashboard period and over the equally long period right before it. Report traces " +
          "(uniqExact(TraceId)), success rate (share of traces where HasError is false), p95 " +
          "latency (quantileExact(0.95) of TotalDurationMs) and total cost (sum of TotalCost). " +
          "Answer with one line per measure: its value now and its change against the " +
          `previous period, as a number and a percentage. ${EVIDENCE}`,
      },
      {
        id: "traffic",
        question: "How much traffic did my agent handle?",
        why: "Every trace that arrived, interval by interval.",
        icon: "activity",
        prompt:
          "How much traffic did my agent handle? Query the LangWatchQL view trace_metrics " +
          `${WINDOW}: count traces with uniqExact(TraceId) per bucket of OccurredAt. ` +
          "Answer with the total for the period, the busiest and the quietest bucket with " +
          `their counts, and a short series of traces per bucket. ${EVIDENCE}`,
      },
    ],
  },
  {
    id: "change",
    title: "What changed?",
    why: "Makes direction, timing and magnitude immediately visible.",
    summary: "Satisfaction, token use and conversation length over time",
    palette: "orange",
    questions: [
      {
        id: "satisfaction-shift",
        question: "Did user satisfaction shift this week?",
        why: "Weekly drift is easy to miss without a line to read it from.",
        icon: "trendingDown",
        prompt:
          "Did user satisfaction shift this week? Query the LangWatchQL view traces " +
          `${WINDOW}: avg(SatisfactionScore) per bucket of OccurredAt, skipping rows where ` +
          "SatisfactionScore is null. Compare the last seven days with the seven days " +
          "before them. Answer with the two averages, the change between them, and the " +
          `bucket where the score moved most. ${EVIDENCE}`,
      },
      {
        id: "token-drift",
        question: "Is token usage drifting up?",
        why: "Slow creep in tokens is a budget problem before it is a spend problem.",
        icon: "coins",
        prompt:
          "Is token usage drifting up? Query the LangWatchQL view trace_metrics_by_minute " +
          `${WINDOW}: sum(PromptTokensSum) and sum(CompletionTokensSum) per bucket of ` +
          "BucketStart. Answer with the first and last bucket's prompt and completion " +
          "tokens, the change between them as a percentage, and whether the trend is up, " +
          `flat or down. ${EVIDENCE}`,
      },
      {
        id: "conversation-length",
        question: "Are conversations getting longer?",
        why: "More turns per thread can mean users are not getting answers.",
        icon: "messageSquare",
        prompt:
          "Are conversations getting longer? Query the LangWatchQL view trace_metrics " +
          `${WINDOW}: per bucket of OccurredAt, count uniqExact(TraceId) for each non-empty ` +
          "ConversationId, then average those counts. Answer with a series of average " +
          "traces per conversation per bucket, and the change from the first bucket to the " +
          `last. ${EVIDENCE}`,
      },
    ],
  },
  {
    id: "threshold",
    title: "Did something cross a line?",
    why: "Shows the current state and whether a breach is passing or persistent.",
    summary: "Latency against its usual level, error rate and top errors",
    palette: "red",
    questions: [
      {
        id: "latency-slo",
        question: "Is p95 latency above our target right now?",
        why: "A latency breach needs a live answer, not a retrospective one.",
        icon: "alertTriangle",
        prompt:
          "Is p95 latency above our target right now? Query the LangWatchQL view " +
          `trace_metrics ${WINDOW}: quantileExact(0.95)(TotalDurationMs) per bucket of ` +
          "OccurredAt. Answer with the p95 in milliseconds for the latest bucket and for the " +
          "whole period, and list the buckets well above the period's p95. No target is " +
          `stored, so ask me for mine if I have not given one. ${EVIDENCE}`,
      },
      {
        id: "error-rate",
        question: "Are more of my traces ending in an error?",
        why: "Catch a rising error rate the day it starts.",
        icon: "xCircle",
        prompt:
          "Are more of my traces ending in an error? Query the LangWatchQL view " +
          `trace_metrics ${WINDOW}: countIf(HasError) / count() per bucket of OccurredAt. ` +
          "Then query spans where StatusCode = 2 for the top five error types from " +
          "SpanAttributes['exception.type'] with their SpanName and count. Answer with the " +
          "error rate series, the first and last bucket's rate, and a top-five table of " +
          `error types. ${EVIDENCE}`,
      },
    ],
  },
  {
    id: "compare",
    title: "A vs B",
    why: "Comparison is the task; time is optional.",
    summary: "Latency spread from typical to worst case",
    palette: "blue",
    questions: [
      {
        id: "latency-spread",
        question: "How far apart are typical and slowest responses?",
        why: "p50, p90 and p99 side by side show how long the tail is.",
        icon: "gitCompare",
        prompt:
          "How far apart are typical and slowest responses? Query the LangWatchQL view " +
          "trace_metrics over the dashboard period: quantileExact at 0.5, 0.9 and 0.99 of " +
          "TotalDurationMs, for the whole period and per bucket of OccurredAt at the " +
          "dashboard grain. Answer with p50, p90 and p99 in milliseconds for the period, the " +
          `ratio of p99 to p50, and the bucket with the longest tail. ${EVIDENCE}`,
      },
    ],
  },
  {
    id: "cost-source",
    title: "Where is cost coming from?",
    why: "Separates total spend from what explains it.",
    summary: "Spend over time, by model, and model usage",
    palette: "yellow",
    questions: [
      {
        id: "spend",
        question: "What are my agents spending?",
        why: "Spot spend before the invoice does.",
        icon: "dollarSign",
        prompt:
          "What are my agents spending? Query the LangWatchQL view trace_metrics_by_minute " +
          `${WINDOW}: sum(CostSum) per bucket of BucketStart. Then query ` +
          "model_usage_by_minute for sum(CostSum) by Model over the same period. Answer " +
          "with total spend in USD, the most expensive bucket, and a top-five table of " +
          `models by cost with each one's share of the total. ${EVIDENCE}`,
      },
      {
        id: "top-models",
        question: "Which models do my traces use most?",
        why: "The models behind most of your traffic, and so most of your bill.",
        icon: "cpu",
        prompt:
          "Which models do my traces use most? Query the LangWatchQL view trace_metrics over " +
          "the dashboard period: arrayJoin(Models) and count uniqExact(TraceId) per model. " +
          "Add each model's sum(CostSum) from model_usage_by_minute over the same period. " +
          "Answer with a top-10 table of models: traces, share of all traces, and cost in " +
          `USD. ${EVIDENCE}`,
      },
    ],
  },
  {
    id: "tradeoff",
    title: "Quality and Quantity",
    why: "Quality read next to volume reveals what averages hide.",
    summary: "Evaluation pass rates and scenario results",
    palette: "teal",
    questions: [
      {
        id: "evaluations",
        question: "Are my evaluations passing?",
        why: "Share of evaluations that passed, interval by interval.",
        icon: "flaskConical",
        prompt:
          "Are my evaluations passing? Query the LangWatchQL view evaluation_metrics " +
          `${WINDOW}: countIf(Passed = 1) / count() per bucket of OccurredAt, skipping rows ` +
          "where Passed is null, and the same pass rate per EvaluatorName. Answer with the " +
          "pass rate for the period, its series per bucket, and a table of the five " +
          `evaluators with the lowest pass rate and their run counts. ${EVIDENCE}`,
      },
      {
        id: "scenarios",
        question: "What are my scenarios telling me?",
        why: "Share of scenario runs the judge passed.",
        icon: "scale",
        prompt:
          "What are my scenarios telling me? Query the LangWatchQL view simulations " +
          `${WINDOW}: rows where ArchivedAt is null and Verdict is not null, by bucket of ` +
          "StartedAt, with countIf(Verdict = 'success') / count() as the pass rate, and the " +
          "same per ScenarioSetId. Answer with the pass rate and run count for the period, " +
          `its series per bucket, and a top-five table of suites by runs. ${EVIDENCE}`,
      },
    ],
  },
  {
    id: "why",
    title: "Who, What, Where, When, and Why",
    why: "Root-cause work needs concrete evidence, not only a high-level chart.",
    summary: "Which topics users bring up, and which are growing",
    palette: "pink",
    questions: [
      {
        id: "topics",
        question: "What are users asking about most?",
        why: "Turn the most common questions into a roadmap.",
        icon: "helpCircle",
        prompt:
          "What are users asking about most? Query the LangWatchQL view trace_metrics over " +
          "the dashboard period: uniqExact(TraceId) per non-empty TopicId, joined to the " +
          "topics view for TopicName. Answer with a top-10 table of topics: name, traces and " +
          "share of all traces with a topic, and name the one topic that grew most across " +
          `the period. ${EVIDENCE}`,
      },
    ],
  },
  {
    id: "howto",
    title: "How do I…?",
    why: "Langy walks you through it, starting from your own numbers.",
    summary: "Slowest steps, top errors and poorly rated traces",
    palette: "purple",
    questions: [
      {
        id: "howto-latency",
        question: "How do I improve my agent's latency?",
        why: "Find the slow tail, then watch it shrink as you fix it.",
        icon: "gauge",
        prompt:
          "How do I improve my agent's latency? Query the LangWatchQL view trace_metrics " +
          "over the dashboard period for p50 and p99 of TotalDurationMs, then the spans " +
          "view for the five SpanName values with the highest total DurationMs, with their " +
          "p95 and count. Answer with those numbers in a table, then three concrete fixes " +
          `aimed at the slowest operations. ${EVIDENCE}`,
      },
      {
        id: "howto-responses",
        question: "How do I improve my agent's responses?",
        why: "Turn the failures you see into fixes, and watch the error rate fall.",
        icon: "messageSquare",
        prompt:
          "How do I improve my agent's responses? Over the dashboard period, query the " +
          "LangWatchQL view trace_metrics for the error rate (countIf(HasError) / count()), " +
          "spans where StatusCode = 2 for the top error types from " +
          "SpanAttributes['exception.type'], and traces for avg(SatisfactionScore). Answer " +
          "with those numbers, the three biggest problems they point to, and one concrete " +
          `fix for each. ${EVIDENCE}`,
      },
      {
        id: "howto-evals",
        question: "How do I set up evaluations for my agent?",
        why: "Start from real traces and watch the pass rate as judges come online.",
        icon: "flaskConical",
        prompt:
          "How do I set up evaluations for my agent? Query the LangWatchQL view " +
          "evaluation_metrics over the dashboard period for each EvaluatorName, its run " +
          "count and pass rate (countIf(Passed = 1) / count()), and trace_metrics for the " +
          "trace count. Answer with what is evaluated today and what share of traffic that " +
          `covers, then the next evaluator to add and the steps to set it up. ${EVIDENCE}`,
      },
    ],
  },
];

/**
 * The sections whose questions match a search, matching on the question, its
 * reason and the section title; a section with no match is dropped.
 */
export function searchBlockQuestions({
  sections,
  search,
}: {
  sections: readonly BlockQuestionSection[];
  search: string;
}): BlockQuestionSection[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return [...sections];
  return sections
    .map((section) => ({
      ...section,
      questions: section.questions.filter((question) =>
        `${question.question} ${question.why} ${section.title}`.toLowerCase().includes(needle),
      ),
    }))
    .filter((section) => section.questions.length > 0);
}
