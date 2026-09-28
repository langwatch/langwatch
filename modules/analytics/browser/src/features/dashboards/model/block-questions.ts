/**
 * The question-first picker's contents: questions grouped by the shape of the
 * answer, each one adding exactly one library block. A question with no block
 * that truly answers it is left out rather than offered as a dead link (AC12).
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
  /** The library block this question adds. */
  readonly blockId: string;
}

export interface BlockQuestionSection {
  readonly id: string;
  readonly title: string;
  readonly why: string;
  /** A design-system colour palette tinting the section title and its icons. */
  readonly palette: string;
  readonly questions: readonly BlockQuestion[];
}

export const BLOCK_QUESTION_SECTIONS: readonly BlockQuestionSection[] = [
  {
    id: "happen",
    title: "What happened?",
    why: "The event is discrete; you need the count as much as the trend.",
    palette: "purple",
    questions: [
      {
        id: "overall",
        question: "How is my agent doing overall?",
        why: "Traffic, success rate, latency and cost against the period before.",
        icon: "gauge",
        blockId: "previous-period-comparison",
      },
      {
        id: "traffic",
        question: "How much traffic did my agent handle?",
        why: "Every trace that arrived, interval by interval.",
        icon: "activity",
        blockId: "trace-count-over-time",
      },
    ],
  },
  {
    id: "change",
    title: "What changed?",
    why: "Makes direction, timing and magnitude immediately visible.",
    palette: "orange",
    questions: [
      {
        id: "satisfaction-shift",
        question: "Did user satisfaction shift this week?",
        why: "Weekly drift is easy to miss without a line to read it from.",
        icon: "trendingDown",
        blockId: "satisfaction-over-time",
      },
      {
        id: "token-drift",
        question: "Is token usage drifting up?",
        why: "Slow creep in tokens is a budget problem before it is a spend problem.",
        icon: "coins",
        blockId: "tokens-over-time",
      },
      {
        id: "conversation-length",
        question: "Are conversations getting longer?",
        why: "More turns per thread can mean users are not getting answers.",
        icon: "messageSquare",
        blockId: "average-traces-per-thread",
      },
    ],
  },
  {
    id: "threshold",
    title: "Did something cross a line?",
    why: "Shows the current state and whether a breach is passing or persistent.",
    palette: "red",
    questions: [
      {
        id: "latency-slo",
        question: "Is p95 latency above our target right now?",
        why: "A latency breach needs a live answer, not a retrospective one.",
        icon: "alertTriangle",
        blockId: "p95-latency-over-time",
      },
      {
        id: "error-rate",
        question: "Are more of my traces ending in an error?",
        why: "Catch a rising error rate the day it starts.",
        icon: "xCircle",
        blockId: "error-rate-over-time",
      },
    ],
  },
  {
    id: "compare",
    title: "A vs B",
    why: "Comparison is the task; time is optional.",
    palette: "blue",
    questions: [
      {
        id: "latency-spread",
        question: "How far apart are typical and slowest responses?",
        why: "p50, p90 and p99 side by side show how long the tail is.",
        icon: "gitCompare",
        blockId: "latency-percentiles",
      },
    ],
  },
  {
    id: "cost-source",
    title: "Where is cost coming from?",
    why: "Separates total spend from what explains it.",
    palette: "yellow",
    questions: [
      {
        id: "spend",
        question: "What are my agents spending?",
        why: "Spot spend before the invoice does.",
        icon: "dollarSign",
        blockId: "total-cost-over-time",
      },
      {
        id: "top-models",
        question: "Which models do my traces use most?",
        why: "The models behind most of your traffic, and so most of your bill.",
        icon: "cpu",
        blockId: "top-models",
      },
    ],
  },
  {
    id: "tradeoff",
    title: "Quality and Quantity",
    why: "Quality read next to volume reveals what averages hide.",
    palette: "teal",
    questions: [
      {
        id: "evaluations",
        question: "Are my evaluations passing?",
        why: "Share of evaluations that passed, interval by interval.",
        icon: "flaskConical",
        blockId: "evaluation-pass-rate",
      },
      {
        id: "scenarios",
        question: "What are my scenarios telling me?",
        why: "Share of scenario runs the judge passed.",
        icon: "scale",
        blockId: "scenario-pass-rate",
      },
    ],
  },
  {
    id: "why",
    title: "Who, What, Where, When, and Why",
    why: "Root-cause work needs concrete evidence, not only a high-level chart.",
    palette: "pink",
    questions: [
      {
        id: "topics",
        question: "What are users asking about most?",
        why: "Turn the most common questions into a roadmap.",
        icon: "helpCircle",
        blockId: "top-topics",
      },
    ],
  },
  {
    id: "howto",
    title: "How do I…?",
    why: "Each question adds the chart that tells you whether your fix worked.",
    palette: "purple",
    questions: [
      {
        id: "howto-latency",
        question: "How do I improve my agent's latency?",
        why: "Find the slow tail, then watch it shrink as you fix it.",
        icon: "gauge",
        blockId: "latency-percentiles",
      },
      {
        id: "howto-responses",
        question: "How do I improve my agent's responses?",
        why: "Turn the failures you see into fixes, and watch the error rate fall.",
        icon: "messageSquare",
        blockId: "error-rate-over-time",
      },
      {
        id: "howto-evals",
        question: "How do I set up evaluations for my agent?",
        why: "Start from real traces and watch the pass rate as judges come online.",
        icon: "flaskConical",
        blockId: "evaluation-pass-rate",
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
