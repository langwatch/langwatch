/**
 * Dashboard widgets — the failures the REST endpoints name.
 *
 * @see ~/server/analytics/lwql/errors.ts — the sibling gate this mirrors
 */
import { HandledError, remediation } from "@langwatch/handled-error";

export const CUSTOM_CHART_PLAYGROUND_FLAG = "release_custom_chart_playground";

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

/**
 * Creating/editing a dashboard graph is refused while the playground is
 * enabled. `customer` fault, 403 — a product decision, not an incident. The
 * message names the flag and points an agent at `dashboard-widget` instead.
 */
export class CustomGraphWritesDisabledForPlaygroundError extends HandledError {
  declare readonly code: "custom_graph_writes_disabled_for_playground";

  constructor() {
    super(
      "custom_graph_writes_disabled_for_playground",
      `Creating or editing dashboard graphs is turned off for this project while the custom-chart-playground is enabled (feature flag: ${CUSTOM_CHART_PLAYGROUND_FLAG}). Do not retry — use the dashboard-widgets skill / \`langwatch dashboard-widget\` commands instead.`,
      {
        httpStatus: 403,
        ...remediation("custom_graph_writes_disabled_for_playground"),
      },
    );
    this.name = "CustomGraphWritesDisabledForPlaygroundError";
  }
}

/**
 * A widget in another project earns this too, on purpose: the answer must
 * not let a caller tell "not yours" from "never existed" — same reasoning
 * as {@link SavedWorkbenchChartNotFoundError}, applied to this id space.
 */
export class DashboardWidgetNotFoundError extends HandledError {
  declare readonly code: "dashboard_widget_not_found";

  constructor() {
    super("dashboard_widget_not_found", "Dashboard widget not found.", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "DashboardWidgetNotFoundError";
  }
}

/**
 * `platform` fault and a 5xx on purpose: every write goes through a schema,
 * so an unreadable row is something this application got wrong. Charging
 * it to the customer would file a real defect as routine noise.
 */
export class DashboardWidgetDefinitionInvalidError extends HandledError {
  declare readonly code: "dashboard_widget_definition_invalid";

  constructor(widgetId: string, options: { reasons?: readonly Error[] } = {}) {
    super(
      "dashboard_widget_definition_invalid",
      "This dashboard widget's definition could not be read.",
      {
        httpStatus: 500,
        fault: "platform",
        meta: { widgetId },
        ...options,
      },
    );
    this.name = "DashboardWidgetDefinitionInvalidError";
  }
}
