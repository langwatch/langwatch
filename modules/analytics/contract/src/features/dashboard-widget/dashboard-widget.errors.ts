/**
 * Dashboard widgets — the failures the REST endpoints name.
 *
 * @see ~/server/analytics/lwql/errors.ts — the sibling gate this mirrors
 */
import { HandledError, remediation } from "@langwatch/handled-error";

const DASHBOARDS_FLAG = "release_dashboards";
const LWQL_WORKBENCH_FLAG = "release_lwql_workbench";

/**
 * The dashboard widget surface is closed for this project. `customer` fault, 403. The code keeps
 * its playground name because clients match on it; the message names the flags so the CLI and
 * Langy's skill stop retrying and reach for `chart`.
 */
export class CustomChartPlaygroundNotEnabledError extends HandledError {
  static readonly code = "custom_chart_playground_not_enabled" as const;
  declare readonly code: "custom_chart_playground_not_enabled";

  constructor() {
    super(
      "custom_chart_playground_not_enabled",
      `Dashboard widgets are not enabled for this project (feature flags: ${DASHBOARDS_FLAG} and ${LWQL_WORKBENCH_FLAG}). Do not retry — use the lwql-charts skill / \`langwatch chart\` commands for a saved dashboard chart instead.`,
      {
        httpStatus: 403,
        ...remediation("custom_chart_playground_not_enabled"),
      },
    );
    this.name = "CustomChartPlaygroundNotEnabledError";
  }
}

/**
 * A widget in another project earns this too, on purpose: the answer must
 * not let a caller tell "not yours" from "never existed" — same reasoning
 * as {@link SavedWorkbenchChartNotFoundError}, applied to this id space.
 */
export class DashboardWidgetNotFoundError extends HandledError {
  static readonly code = "dashboard_widget_not_found" as const;
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
  static readonly code = "dashboard_widget_definition_invalid" as const;
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
