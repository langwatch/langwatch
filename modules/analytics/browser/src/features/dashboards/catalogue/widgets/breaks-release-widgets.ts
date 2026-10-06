/**
 * The built widgets of the "Where my agent breaks" and "Release check" boards, keyed
 * by catalogue id. Loops and retries are read from repeated spans in a trace; a test
 * run is one batch of scenario runs, since the scenario view does not name its target.
 */

import { ERROR_RATE_SQL } from "../../templates/model/flight-deck-queries.ts";
import { TABLE_ROWS } from "../../templates/model/template-widget.ts";
import * as breaks from "./breaks-queries.ts";
import * as breaksCode from "./breaks-widgets-code.ts";
import { CHANGES_SQL } from "./change-queries.ts";
import type { CatalogueWidgetBuild } from "./index.ts";
import * as release from "./release-queries.ts";
import * as releaseCode from "./release-widgets-code.ts";

const CHART = 6;

export const BREAKS_RELEASE_WIDGET_BUILDS: Readonly<Record<string, CatalogueWidgetBuild>> = {
  "up-errors": {
    code: breaksCode.ERRORS_PER_DAY_CODE,
    queries: { types: breaks.ERRORS_BY_TYPE_SQL, rate: ERROR_RATE_SQL, changes: CHANGES_SQL },
    width: "full",
    rows: CHART,
  },
  "up-where-fails": {
    code: breaksCode.FAILING_STEPS_CODE,
    queries: { main: breaks.FAILING_STEPS_SQL },
    width: "half",
    rows: CHART,
  },
  "up-loops": {
    code: breaksCode.LOOPS_AND_RETRIES_CODE,
    queries: {
      daily: breaks.REPEATS_BY_BUCKET_SQL,
      steps: breaks.REPEATED_STEPS_SQL,
      totals: breaks.TRAFFIC_AND_SPEND_SQL,
    },
    width: "half",
    rows: CHART,
  },
  "tools-error-rate": {
    code: breaksCode.TOOL_ERROR_RATE_CODE,
    queries: { main: breaks.TOOL_FAILURES_SQL },
    width: "half",
    rows: CHART,
  },
  "tools-wrong-tool": {
    code: breaksCode.WRONG_TOOL_CODE,
    queries: {
      trend: breaks.WRONG_TOOL_TREND_SQL,
      halves: breaks.WRONG_TOOL_HALVES_SQL,
      changes: CHANGES_SQL,
    },
    width: "half",
    rows: CHART,
  },
  "ship-verdict": {
    code: releaseCode.NEW_VERSION_CODE,
    queries: { scenarios: release.NEW_VERSION_SCENARIOS_SQL, costs: release.NEW_VERSION_COST_SQL },
    width: "full",
    rows: CHART,
  },
  "ship-flaky": {
    code: releaseCode.FLAKY_TESTS_CODE,
    queries: { main: release.FLAKY_SCENARIOS_SQL },
    width: "half",
    rows: CHART,
  },
  "ship-compare": {
    code: releaseCode.RUNS_COMPARED_CODE,
    queries: { main: release.LAST_RUNS_SQL },
    width: "full",
    rows: TABLE_ROWS,
  },
  "ship-rollout": {
    code: releaseCode.ROLLOUT_CODE,
    queries: {
      changes: CHANGES_SQL,
      traffic: release.ROLLOUT_TRAFFIC_SQL,
      checks: release.ROLLOUT_CHECKS_SQL,
    },
    width: "half",
    rows: TABLE_ROWS,
  },
  "ship-models": {
    code: releaseCode.MODELS_COMPARED_CODE,
    queries: { main: release.MODEL_COMPARISON_SQL },
    width: "half",
    rows: TABLE_ROWS,
  },
  "rag-dataset-versions": {
    code: releaseCode.TEST_SET_DRIFT_CODE,
    queries: { main: release.TEST_SET_RUNS_SQL },
    width: "half",
    rows: CHART,
  },
  "ext-precision-recall": {
    code: releaseCode.FIELD_ACCURACY_CODE,
    queries: { main: release.FIELD_ACCURACY_RUNS_SQL },
    width: "half",
    rows: CHART,
  },
};
