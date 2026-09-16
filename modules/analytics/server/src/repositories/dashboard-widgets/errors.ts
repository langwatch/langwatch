/**
 * Dashboard widgets — the failures the REST endpoints name.
 *
 * @see ~/server/analytics/lwql/errors.ts — the sibling gate this mirrors
 */
import { HandledError, remediation } from "@langwatch/handled-error";

import { CUSTOM_CHART_PLAYGROUND_FLAG } from "./access.ts";

/**
 * The custom-chart-playground surface is off for this project. `customer`
 * fault, 403 — a product decision, not an incident. The message names the
 * flag so the CLI and Langy's skill stop retrying and reach for `chart`.
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
