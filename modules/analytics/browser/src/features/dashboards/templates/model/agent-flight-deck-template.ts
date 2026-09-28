/**
 * The Agent Flight Deck as a board template: ten stored widgets in the
 * prototype's order. Status and Throughput span the grid; the rest sit in pairs.
 */

import {
  DASHBOARD_WIDGET_DEFINITION_VERSION,
  type DashboardWidgetDefinition,
} from "../../../../model/dashboard-widget-definition.ts";
import type { BoardTemplate, BoardTemplateWidget } from "./board-template.ts";
import {
  FEEDBACK_CODE,
  QUALITY_CODE,
  STATUS_CODE,
  THROUGHPUT_CODE,
} from "./flight-deck-chart-widgets.ts";
import * as sql from "./flight-deck-queries.ts";
import {
  CODING_AGENTS_CODE,
  COST_EFFICIENCY_CODE,
  FAILURES_CODE,
  GATEWAY_CODE,
  IMPACTFUL_TRACES_CODE,
  SCENARIOS_CODE,
} from "./flight-deck-table-widgets.ts";

function definition({
  code,
  queries,
}: {
  code: string;
  queries: Readonly<Record<string, string>>;
}): DashboardWidgetDefinition {
  return {
    version: DASHBOARD_WIDGET_DEFINITION_VERSION,
    code,
    queries: Object.entries(queries).map(([name, text]) => ({ name, sql: text, parameters: [] })),
  };
}

const FULL = 8;
const HALF = 4;

/** A widget in a pair: left or right half of the rows that start at `gridRow`. */
function half({
  side,
  gridRow,
  rowSpan = 4,
}: {
  side: "left" | "right";
  gridRow: number;
  rowSpan?: number;
}) {
  return { gridColumn: side === "left" ? 0 : HALF, gridRow, colSpan: HALF, rowSpan };
}

const WIDGETS: readonly BoardTemplateWidget[] = [
  {
    key: "status",
    name: "Status",
    definition: definition({ code: STATUS_CODE, queries: { main: sql.PERIOD_COMPARISON_SQL } }),
    layout: { gridColumn: 0, gridRow: 0, colSpan: FULL, rowSpan: 3 },
  },
  {
    key: "throughput",
    name: "Throughput, latency & errors",
    definition: definition({ code: THROUGHPUT_CODE, queries: { main: sql.THROUGHPUT_SQL } }),
    layout: { gridColumn: 0, gridRow: 3, colSpan: FULL, rowSpan: 4 },
  },
  {
    key: "cost-efficiency",
    name: "Cost efficiency",
    definition: definition({
      code: COST_EFFICIENCY_CODE,
      queries: { summary: sql.COST_SUMMARY_SQL, models: sql.COST_BY_MODEL_SQL },
    }),
    layout: half({ side: "left", gridRow: 7, rowSpan: 3 }),
  },
  {
    key: "failures",
    name: "Failure intelligence",
    definition: definition({ code: FAILURES_CODE, queries: { main: sql.FAILURES_SQL } }),
    layout: half({ side: "right", gridRow: 7, rowSpan: 3 }),
  },
  {
    key: "scenarios",
    name: "Scenario results",
    definition: definition({
      code: SCENARIOS_CODE,
      queries: { summary: sql.SCENARIO_SUMMARY_SQL, suites: sql.SCENARIO_SUITES_SQL },
    }),
    layout: half({ side: "left", gridRow: 10 }),
  },
  {
    key: "quality",
    name: "Quality signal",
    definition: definition({
      code: QUALITY_CODE,
      queries: { passRate: sql.EVALUATION_PASS_RATE_SQL, errorRate: sql.ERROR_RATE_SQL },
    }),
    layout: half({ side: "right", gridRow: 10 }),
  },
  {
    key: "feedback",
    name: "User feedback",
    definition: definition({
      code: FEEDBACK_CODE,
      queries: { summary: sql.FEEDBACK_SUMMARY_SQL, rate: sql.FEEDBACK_RATE_SQL },
    }),
    layout: half({ side: "left", gridRow: 14 }),
  },
  {
    key: "gateway",
    name: "Gateway routing",
    definition: definition({ code: GATEWAY_CODE, queries: { main: sql.GATEWAY_ROUTES_SQL } }),
    layout: half({ side: "right", gridRow: 14 }),
  },
  {
    key: "coding-agents",
    name: "Your coding agents",
    definition: definition({
      code: CODING_AGENTS_CODE,
      queries: { agents: sql.CODING_AGENTS_SQL, trend: sql.CODING_AGENT_TREND_SQL },
    }),
    layout: half({ side: "left", gridRow: 18 }),
  },
  {
    key: "impactful-traces",
    name: "Most impactful traces",
    definition: definition({
      code: IMPACTFUL_TRACES_CODE,
      queries: { main: sql.IMPACTFUL_TRACES_SQL },
    }),
    layout: half({ side: "right", gridRow: 18 }),
  },
];

export const AGENT_FLIGHT_DECK_TEMPLATE: BoardTemplate = {
  id: "agent-flight-deck",
  name: "Agent Flight Deck",
  description: "Traffic, quality, latency and cost on one timeline.",
  widgets: WIDGETS,
};
