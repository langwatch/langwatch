/**
 * The builds of the Flight Deck's cockpit and use-case cards and the Running costs board,
 * keyed by catalogue widget id. Status today and Spend by model are built elsewhere.
 */

import { TABLE_ROWS } from "../../templates/model/template-widget.ts";
import * as deck from "./flight-deck-code.ts";
import * as sql from "./flight-deck-costs-queries.ts";
import type { CatalogueWidgetBuild } from "./index.ts";
import * as costs from "./running-costs-code.ts";

const CHART = 6;
/** A chart under a row of figures. */
const FIGURES_AND_CHART = 7;
/** A row of figure tiles across the board. */
const TILES = 3;

export const FLIGHT_DECK_COSTS_BUILDS: Readonly<Record<string, CatalogueWidgetBuild>> = {
  "ck-kpis": {
    code: deck.KPIS_CODE,
    queries: {
      outcomes: sql.OUTCOME_COMPARISON_SQL,
      spend: sql.SPEND_COMPARISON_SQL,
      checks: sql.CHECKS_COMPARISON_SQL,
    },
    width: "full",
    rows: TILES,
  },
  "ck-attention": {
    code: deck.ATTENTION_CODE,
    queries: {
      segments: sql.SEGMENT_PASS_RATES_SQL,
      reasons: sql.OUTCOME_REASONS_SQL,
      agreement: sql.JUDGE_AGREEMENT_SQL,
      step: sql.FAILING_STEP_SQL,
    },
    width: "half",
    rows: TABLE_ROWS,
  },
  "ck-top-ask": {
    code: deck.TOP_ASK_CODE,
    queries: { gap: sql.CANNOT_SERVE_SQL, seen: sql.OUTCOMES_SEEN_SQL },
    width: "half",
    rows: TABLE_ROWS,
  },
  "ck-trend": {
    code: deck.RESOLVED_TREND_CODE,
    queries: {
      trend: sql.RESOLVED_TREND_SQL,
      changes: sql.CHANGES_SQL,
      seen: sql.OUTCOMES_SEEN_SQL,
    },
    width: "half",
    rows: CHART,
  },
  "voice-task-success": {
    code: deck.TASK_SUCCESS_CODE,
    queries: { trend: sql.TASK_SUCCESS_TREND_SQL, seen: sql.OUTCOMES_SEEN_SQL },
    width: "half",
    rows: FIGURES_AND_CHART,
  },
  "gen-acceptance": {
    code: deck.ACCEPTANCE_CODE,
    queries: { actions: sql.OUTPUT_ACTIONS_SQL, seen: sql.OUTPUT_ACTIONS_SEEN_SQL },
    width: "half",
    rows: FIGURES_AND_CHART,
  },
  "cost-verdict": {
    code: costs.SPEND_CODE,
    queries: {
      spend: sql.SPEND_COMPARISON_SQL,
      outcomes: sql.OUTCOME_COMPARISON_SQL,
      month: sql.MONTH_FORECAST_SQL,
    },
    width: "full",
    rows: TILES,
  },
  "cost-by-source": {
    code: costs.SPEND_BY_SOURCE_CODE,
    queries: { main: sql.SPEND_BY_SOURCE_SQL },
    width: "half",
    rows: FIGURES_AND_CHART,
  },
  "cost-waste": {
    code: costs.WASTE_CODE,
    queries: { main: sql.WASTE_SQL },
    width: "half",
    rows: TABLE_ROWS,
  },
  "voice-cost-per-call": {
    code: costs.COST_PER_CALL_CODE,
    queries: { total: sql.COST_PER_CALL_SQL, trend: sql.COST_PER_CALL_TREND_SQL },
    width: "half",
    rows: FIGURES_AND_CHART,
  },
  "ext-cost-per-doc": {
    code: costs.COST_PER_DOCUMENT_CODE,
    queries: {
      trend: sql.DOCUMENT_COST_TREND_SQL,
      halves: sql.DOCUMENT_COST_HALVES_SQL,
      changes: sql.CHANGES_SQL,
    },
    width: "half",
    rows: FIGURES_AND_CHART,
  },
};
