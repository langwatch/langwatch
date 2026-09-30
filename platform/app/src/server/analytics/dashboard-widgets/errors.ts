/**
 * Dashboard widgets — the failures the REST endpoints name.
 *
 * @see ~/server/analytics/lwql/errors.ts — the sibling gate this mirrors
 */
import { HandledError } from "@langwatch/handled-error";

import { remediation } from "~/server/app-layer/error-remediation";
import { CUSTOM_CHART_PLAYGROUND_FLAG } from "./access";

/**
 * The custom-chart-playground surface is switched off for this project.
 *
 * `customer` fault, 403 — a product decision an administrator can change,
 * not an incident. The message NAMES the flag deliberately: the CLI and
 * Langy's own `dashboard-widget` skill are the two callers of this route
 * outside the page itself, and both need to tell "gated off" apart from a
 * generic failure so they stop retrying and reach for lwql-charts / `chart`
 * instead.
 */
export class CustomChartPlaygroundNotEnabledError extends HandledError {
  declare readonly code: "custom_chart_playground_not_enabled";

  constructor() {
    super(
      "custom_chart_playground_not_enabled",
      `The custom-chart-playground surface is not enabled for this project (feature flag: ${CUSTOM_CHART_PLAYGROUND_FLAG}). Do not retry — use the lwql-charts skill / \`langwatch chart\` commands for a saved dashboard chart instead.`,
      {
        httpStatus: 403,
        ...remediation("custom_chart_playground_not_enabled"),
      },
    );
    this.name = "CustomChartPlaygroundNotEnabledError";
  }
}
