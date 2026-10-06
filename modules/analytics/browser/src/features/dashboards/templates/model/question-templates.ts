/**
 * One board template per question-picker section, named and described after the
 * section, with at least one stored widget answering each of its questions.
 * A chart pair is six board rows tall; a table is shorter, at TABLE_ROWS.
 */

import { BLOCK_QUESTION_SECTIONS } from "../../model/block-questions.ts";
import type { BoardTemplate, BoardTemplateId, BoardTemplateWidget } from "./board-template.ts";
import { statusCode } from "./flight-deck-chart-widgets.ts";
import * as deck from "./flight-deck-queries.ts";
import { SCENARIOS_CODE } from "./flight-deck-table-widgets.ts";
import * as chart from "./question-chart-widgets.ts";
import * as sql from "./question-queries.ts";
import * as table from "./question-table-widgets.ts";
import { definition, full, half, TABLE_ROWS } from "./template-widget.ts";
import type { WidgetCode } from "./widget-code-parts.ts";

const PAIR = 6;

function widget({
  key,
  name,
  code,
  queries,
  layout,
}: {
  key: string;
  name: string;
  code: WidgetCode;
  queries: Readonly<Record<string, string>>;
  layout: BoardTemplateWidget["layout"];
}): BoardTemplateWidget {
  return { key, name, definition: definition({ code, queries }), layout };
}

/** A template titled and described by the picker section with the same id. */
function sectionTemplate({
  id,
  widgets,
}: {
  id: Exclude<BoardTemplateId, "agent-flight-deck">;
  widgets: readonly BoardTemplateWidget[];
}): BoardTemplate {
  const section = BLOCK_QUESTION_SECTIONS.find((candidate) => candidate.id === id);
  if (!section) throw new Error(`No question section "${id}" for its board template`);
  return { id, name: section.title, description: section.why, summary: section.summary, widgets };
}

const ERROR_TYPES = {
  code: table.ERROR_TYPES_CODE,
  queries: { types: deck.FAILURES_SQL, traffic: sql.TRACE_COUNT_SQL },
};

export const WHAT_HAPPENED_TEMPLATE = sectionTemplate({
  id: "happen",
  widgets: [
    widget({
      key: "overall",
      name: "How is my agent doing overall?",
      code: statusCode({ source: "requests" }),
      queries: { main: deck.PERIOD_COMPARISON_SQL },
      layout: full({ gridRow: 0, rowSpan: 3 }),
    }),
    widget({
      key: "traffic",
      name: "How much traffic did my agent handle?",
      code: chart.TRAFFIC_CODE,
      queries: { main: sql.TRAFFIC_SQL },
      layout: full({ gridRow: 3, rowSpan: PAIR }),
    }),
  ],
});

export const WHAT_CHANGED_TEMPLATE = sectionTemplate({
  id: "change",
  widgets: [
    widget({
      key: "satisfaction-shift",
      name: "Did user satisfaction shift?",
      code: chart.SATISFACTION_CODE,
      queries: { trend: sql.SATISFACTION_TREND_SQL, comparison: sql.SATISFACTION_COMPARISON_SQL },
      layout: half({ side: "left", gridRow: 0, rowSpan: PAIR }),
    }),
    widget({
      key: "token-drift",
      name: "Is token usage drifting up?",
      code: chart.TOKEN_DRIFT_CODE,
      queries: { main: sql.TOKEN_TREND_SQL },
      layout: half({ side: "right", gridRow: 0, rowSpan: PAIR }),
    }),
    widget({
      key: "conversation-length",
      name: "Are conversations getting longer?",
      code: chart.CONVERSATION_LENGTH_CODE,
      queries: { main: sql.CONVERSATION_LENGTH_SQL },
      layout: full({ gridRow: PAIR, rowSpan: PAIR }),
    }),
  ],
});

export const CROSSED_A_LINE_TEMPLATE = sectionTemplate({
  id: "threshold",
  widgets: [
    widget({
      key: "latency-slo",
      name: "Is p95 latency above target?",
      code: chart.P95_LATENCY_CODE,
      queries: { trend: sql.P95_TREND_SQL, period: sql.LATENCY_SPREAD_SQL },
      layout: full({ gridRow: 0, rowSpan: PAIR }),
    }),
    widget({
      key: "error-rate",
      name: "Are more of my traces ending in an error?",
      code: chart.ERROR_RATE_CODE,
      queries: { main: deck.ERROR_RATE_SQL },
      layout: half({ side: "left", gridRow: PAIR, rowSpan: PAIR }),
    }),
    widget({
      key: "error-types",
      name: "Top error types",
      ...ERROR_TYPES,
      layout: half({ side: "right", gridRow: PAIR, rowSpan: TABLE_ROWS }),
    }),
  ],
});

export const A_VS_B_TEMPLATE = sectionTemplate({
  id: "compare",
  widgets: [
    widget({
      key: "latency-spread",
      name: "How far apart are typical and slowest responses?",
      code: chart.LATENCY_SPREAD_CODE,
      queries: { period: sql.LATENCY_SPREAD_SQL, trend: sql.LATENCY_PERCENTILES_SQL },
      layout: full({ gridRow: 0, rowSpan: 8 }),
    }),
  ],
});

export const COST_SOURCE_TEMPLATE = sectionTemplate({
  id: "cost-source",
  widgets: [
    widget({
      key: "spend",
      name: "What are my agents spending?",
      code: chart.SPEND_CODE,
      queries: { main: sql.COST_TREND_SQL },
      layout: full({ gridRow: 0, rowSpan: PAIR }),
    }),
    widget({
      key: "spend-by-model",
      name: "Spend by model",
      code: table.MODEL_SPEND_CODE,
      queries: { models: deck.COST_BY_MODEL_SQL, spend: sql.MODEL_SPEND_TOTAL_SQL },
      layout: half({ side: "left", gridRow: PAIR, rowSpan: TABLE_ROWS }),
    }),
    widget({
      key: "top-models",
      name: "Which models do my traces use most?",
      code: table.TOP_MODELS_CODE,
      queries: {
        models: sql.TOP_MODELS_SQL,
        modelCosts: sql.MODEL_COSTS_SQL,
        traffic: sql.TRACE_COUNT_SQL,
      },
      layout: half({ side: "right", gridRow: PAIR, rowSpan: TABLE_ROWS }),
    }),
  ],
});

export const QUALITY_AND_QUANTITY_TEMPLATE = sectionTemplate({
  id: "tradeoff",
  widgets: [
    widget({
      key: "evaluations",
      name: "Are my evaluations passing?",
      code: chart.EVALUATION_PASS_RATE_CODE,
      queries: { totals: sql.EVALUATION_SUMMARY_SQL, trend: deck.EVALUATION_PASS_RATE_SQL },
      layout: half({ side: "left", gridRow: 0, rowSpan: PAIR }),
    }),
    widget({
      key: "lowest-passing-evaluators",
      name: "Lowest-passing evaluators",
      code: table.LOWEST_PASSING_EVALUATORS_CODE,
      queries: { main: sql.LOWEST_PASSING_EVALUATORS_SQL },
      layout: half({ side: "right", gridRow: 0, rowSpan: TABLE_ROWS }),
    }),
    widget({
      key: "scenarios",
      name: "What are my scenarios telling me?",
      code: chart.SCENARIO_PASS_RATE_CODE,
      queries: { totals: deck.SCENARIO_SUMMARY_SQL, trend: sql.SCENARIO_TREND_SQL },
      layout: half({ side: "left", gridRow: PAIR, rowSpan: PAIR }),
    }),
    widget({
      key: "scenario-suites",
      name: "Scenario suites",
      code: SCENARIOS_CODE,
      queries: { summary: deck.SCENARIO_SUMMARY_SQL, suites: deck.SCENARIO_SUITES_SQL },
      layout: half({ side: "right", gridRow: PAIR, rowSpan: TABLE_ROWS }),
    }),
  ],
});

export const ROOT_CAUSE_TEMPLATE = sectionTemplate({
  id: "why",
  widgets: [
    widget({
      key: "topics",
      name: "What are users asking about most?",
      code: table.TOPICS_CODE,
      queries: { topics: sql.TOPICS_SQL, topicTraffic: sql.TOPIC_TRACES_SQL },
      layout: full({ gridRow: 0, rowSpan: TABLE_ROWS }),
    }),
  ],
});

export const HOW_DO_I_TEMPLATE = sectionTemplate({
  id: "howto",
  widgets: [
    widget({
      key: "slowest-operations",
      name: "Improve latency: slowest operations",
      code: table.SLOWEST_OPERATIONS_CODE,
      queries: { operations: sql.SLOWEST_OPERATIONS_SQL, latency: sql.LATENCY_SPREAD_SQL },
      layout: half({ side: "left", gridRow: 0, rowSpan: TABLE_ROWS }),
    }),
    widget({
      key: "slowest-models",
      name: "Improve latency: slowest models",
      code: table.SLOWEST_MODELS_CODE,
      queries: { main: sql.SLOWEST_MODELS_SQL },
      layout: half({ side: "right", gridRow: 0, rowSpan: TABLE_ROWS }),
    }),
    widget({
      key: "error-types",
      name: "Improve responses: top error types",
      ...ERROR_TYPES,
      layout: half({ side: "left", gridRow: TABLE_ROWS, rowSpan: TABLE_ROWS }),
    }),
    widget({
      key: "thumbs-down",
      name: "Improve responses: traces reviewers voted down",
      code: table.THUMBS_DOWN_CODE,
      queries: { summary: deck.FEEDBACK_SUMMARY_SQL, traces: sql.THUMBS_DOWN_SQL },
      layout: half({ side: "right", gridRow: TABLE_ROWS, rowSpan: TABLE_ROWS }),
    }),
    widget({
      key: "lowest-scores",
      name: "Improve responses: lowest-scoring evaluations",
      code: table.LOWEST_SCORES_CODE,
      queries: { main: sql.LOWEST_SCORES_SQL },
      layout: half({ side: "left", gridRow: 2 * TABLE_ROWS, rowSpan: TABLE_ROWS }),
    }),
    widget({
      key: "evaluation-coverage",
      name: "Set up evaluations: coverage per evaluator",
      code: table.EVALUATION_COVERAGE_CODE,
      queries: {
        evaluators: sql.EVALUATION_COVERAGE_SQL,
        evaluated: sql.EVALUATED_TRACES_SQL,
        traffic: sql.TRACE_COUNT_SQL,
      },
      layout: half({ side: "right", gridRow: 2 * TABLE_ROWS, rowSpan: TABLE_ROWS }),
    }),
  ],
});

/** The question templates in the picker's section order. */
export const QUESTION_TEMPLATES: readonly BoardTemplate[] = [
  WHAT_HAPPENED_TEMPLATE,
  WHAT_CHANGED_TEMPLATE,
  CROSSED_A_LINE_TEMPLATE,
  A_VS_B_TEMPLATE,
  COST_SOURCE_TEMPLATE,
  QUALITY_AND_QUANTITY_TEMPLATE,
  ROOT_CAUSE_TEMPLATE,
  HOW_DO_I_TEMPLATE,
];
