/**
 * Every catalogue widget that has code, keyed by catalogue widget id: its stored TSX,
 * its named queries and its place on a board. A widget without an entry is coming soon.
 */

import * as deckChart from "../../templates/model/flight-deck-chart-widgets.ts";
import * as deck from "../../templates/model/flight-deck-queries.ts";
import * as deckTable from "../../templates/model/flight-deck-table-widgets.ts";
import * as chart from "../../templates/model/question-chart-widgets.ts";
import * as sql from "../../templates/model/question-queries.ts";
import * as table from "../../templates/model/question-table-widgets.ts";
import { TABLE_ROWS } from "../../templates/model/template-widget.ts";
import type { WidgetCode } from "../../templates/model/widget-code-parts.ts";
import { AGENT_KIND_WIDGET_BUILDS } from "./agent-kind-widgets.ts";
import { ANSWERS_ASKS_WIDGET_BUILDS } from "./answers-asks-widgets.ts";
import { BREAKS_RELEASE_WIDGET_BUILDS } from "./breaks-release-widgets.ts";
import { FLIGHT_DECK_COSTS_BUILDS } from "./flight-deck-costs-widgets.ts";

/** One built widget: its code, its named queries and its place on a board. */
export interface CatalogueWidgetBuild {
  readonly code: WidgetCode;
  readonly queries: Readonly<Record<string, string>>;
  readonly width: "full" | "half";
  /** Board rows high: a chart is 6, a table 4, a strip of tiles 3. */
  readonly rows: number;
}

const CHART = 6;

export const CATALOGUE_WIDGET_BUILDS: Readonly<Record<string, CatalogueWidgetBuild>> = {
  "ck-status": {
    code: deckChart.STATUS_CODE,
    queries: { main: deck.PERIOD_COMPARISON_SQL },
    width: "full",
    rows: 3,
  },
  "fd-throughput": {
    code: deckChart.THROUGHPUT_CODE,
    queries: { main: deck.THROUGHPUT_SQL },
    width: "full",
    rows: CHART,
  },
  "fd-cost-efficiency": {
    code: deckTable.COST_EFFICIENCY_CODE,
    queries: { summary: deck.COST_SUMMARY_SQL, models: deck.COST_BY_MODEL_SQL },
    width: "half",
    rows: TABLE_ROWS,
  },
  "fd-failures": {
    code: deckTable.FAILURES_CODE,
    queries: { main: deck.FAILURES_SQL },
    width: "half",
    rows: TABLE_ROWS,
  },
  "ship-suites": {
    code: deckTable.SCENARIOS_CODE,
    queries: { summary: deck.SCENARIO_SUMMARY_SQL, suites: deck.SCENARIO_SUITES_SQL },
    width: "half",
    rows: TABLE_ROWS,
  },
  "fd-quality": {
    code: deckChart.QUALITY_CODE,
    queries: { passRate: deck.EVALUATION_PASS_RATE_SQL, errorRate: deck.ERROR_RATE_SQL },
    width: "half",
    rows: 5,
  },
  "fd-feedback": {
    code: deckChart.FEEDBACK_CODE,
    queries: { summary: deck.FEEDBACK_SUMMARY_SQL, rate: deck.FEEDBACK_RATE_SQL },
    width: "half",
    rows: 5,
  },
  "fd-gateway": {
    code: deckTable.GATEWAY_CODE,
    queries: { main: deck.GATEWAY_ROUTES_SQL },
    width: "half",
    rows: TABLE_ROWS,
  },
  "fd-coding-agents": {
    code: deckTable.CODING_AGENTS_CODE,
    queries: { agents: deck.CODING_AGENTS_SQL, trend: deck.CODING_AGENT_TREND_SQL },
    width: "full",
    rows: TABLE_ROWS,
  },
  "up-failing-traces": {
    code: deckTable.IMPACTFUL_TRACES_CODE,
    queries: { main: deck.IMPACTFUL_TRACES_SQL },
    width: "full",
    rows: TABLE_ROWS,
  },
  traffic: {
    code: chart.TRAFFIC_CODE,
    queries: { main: sql.TRAFFIC_SQL },
    width: "full",
    rows: CHART,
  },
  "satisfaction-shift": {
    code: chart.SATISFACTION_CODE,
    queries: { trend: sql.SATISFACTION_TREND_SQL, comparison: sql.SATISFACTION_COMPARISON_SQL },
    width: "half",
    rows: CHART,
  },
  "token-drift": {
    code: chart.TOKEN_DRIFT_CODE,
    queries: { main: sql.TOKEN_TREND_SQL },
    width: "half",
    rows: CHART,
  },
  "conversation-length": {
    code: chart.CONVERSATION_LENGTH_CODE,
    queries: { main: sql.CONVERSATION_LENGTH_SQL },
    width: "full",
    rows: CHART,
  },
  "latency-slo": {
    code: chart.P95_LATENCY_CODE,
    queries: { trend: sql.P95_TREND_SQL, period: sql.LATENCY_SPREAD_SQL },
    width: "full",
    rows: CHART,
  },
  "error-rate": {
    code: chart.ERROR_RATE_CODE,
    queries: { main: deck.ERROR_RATE_SQL },
    width: "half",
    rows: CHART,
  },
  "latency-spread": {
    code: chart.LATENCY_SPREAD_CODE,
    queries: { period: sql.LATENCY_SPREAD_SQL, trend: sql.LATENCY_PERCENTILES_SQL },
    width: "full",
    rows: 8,
  },
  spend: {
    code: chart.SPEND_CODE,
    queries: { main: sql.COST_TREND_SQL },
    width: "full",
    rows: CHART,
  },
  "cost-by-model": {
    code: table.MODEL_SPEND_CODE,
    queries: { models: deck.COST_BY_MODEL_SQL, spend: sql.MODEL_SPEND_TOTAL_SQL },
    width: "half",
    rows: TABLE_ROWS,
  },
  "top-models": {
    code: table.TOP_MODELS_CODE,
    queries: {
      models: sql.TOP_MODELS_SQL,
      modelCosts: sql.MODEL_COSTS_SQL,
      traffic: sql.TRACE_COUNT_SQL,
    },
    width: "half",
    rows: TABLE_ROWS,
  },
  "ans-evaluators": {
    code: chart.EVALUATION_PASS_RATE_CODE,
    queries: { totals: sql.EVALUATION_SUMMARY_SQL, trend: deck.EVALUATION_PASS_RATE_SQL },
    width: "half",
    rows: CHART,
  },
  "lowest-passing-evaluators": {
    code: table.LOWEST_PASSING_EVALUATORS_CODE,
    queries: { main: sql.LOWEST_PASSING_EVALUATORS_SQL },
    width: "half",
    rows: TABLE_ROWS,
  },
  scenarios: {
    code: chart.SCENARIO_PASS_RATE_CODE,
    queries: { totals: deck.SCENARIO_SUMMARY_SQL, trend: sql.SCENARIO_TREND_SQL },
    width: "half",
    rows: CHART,
  },
  topics: {
    code: table.TOPICS_CODE,
    queries: { topics: sql.TOPICS_SQL, topicTraffic: sql.TOPIC_TRACES_SQL },
    width: "full",
    rows: TABLE_ROWS,
  },
  "up-step-latency": {
    code: table.SLOWEST_OPERATIONS_CODE,
    queries: { operations: sql.SLOWEST_OPERATIONS_SQL, latency: sql.LATENCY_SPREAD_SQL },
    width: "half",
    rows: TABLE_ROWS,
  },
  "slowest-models": {
    code: table.SLOWEST_MODELS_CODE,
    queries: { main: sql.SLOWEST_MODELS_SQL },
    width: "half",
    rows: TABLE_ROWS,
  },
  "thumbs-down": {
    code: table.THUMBS_DOWN_CODE,
    queries: { summary: deck.FEEDBACK_SUMMARY_SQL, traces: sql.THUMBS_DOWN_SQL },
    width: "half",
    rows: TABLE_ROWS,
  },
  "lowest-scores": {
    code: table.LOWEST_SCORES_CODE,
    queries: { main: sql.LOWEST_SCORES_SQL },
    width: "half",
    rows: TABLE_ROWS,
  },
  "evaluation-coverage": {
    code: table.EVALUATION_COVERAGE_CODE,
    queries: {
      evaluators: sql.EVALUATION_COVERAGE_SQL,
      evaluated: sql.EVALUATED_TRACES_SQL,
      traffic: sql.TRACE_COUNT_SQL,
    },
    width: "half",
    rows: TABLE_ROWS,
  },
  ...ANSWERS_ASKS_WIDGET_BUILDS,
  ...BREAKS_RELEASE_WIDGET_BUILDS,
  ...FLIGHT_DECK_COSTS_BUILDS,
  ...AGENT_KIND_WIDGET_BUILDS,
};
