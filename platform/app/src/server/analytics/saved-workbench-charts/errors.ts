/**
 * The refusals a saved workbench chart can earn.
 *
 * Only the failures with no existing home are named here. A statement the
 * LangWatchQL validator refuses keeps *its* refusal — `lwql_unparseable`,
 * `lwql_not_permitted`, `lwql_parameter_missing` — because the
 * cause is identical whether the member pressed Run or Save, and a parallel
 * code would fork copy, remediation and client rendering that already exist for
 * the same mistake.
 *
 * @see dev/docs/best_practices/error-handling.md
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { HandledError } from "@langwatch/handled-error";

import type { VegaValidationError } from "~/features/analytics-query/visualization/visualization.types";
import { CUSTOM_CHART_PLAYGROUND_FLAG } from "~/server/analytics/dashboard-widgets/access";
import { remediation } from "~/server/app-layer/error-remediation";

/**
 * No chart with that id in this project.
 *
 * A chart belonging to another project earns this too, and that is the point:
 * the answer must not let a caller tell "not yours" from "never existed", or
 * the id space becomes a directory of other tenants' charts.
 */
export class SavedWorkbenchChartNotFoundError extends HandledError {
  declare readonly code: "saved_workbench_chart_not_found";

  constructor() {
    super("saved_workbench_chart_not_found", "Saved chart not found.", {
      httpStatus: 404,
      fault: "customer",
      ...remediation("saved_workbench_chart_not_found"),
    });
    this.name = "SavedWorkbenchChartNotFoundError";
  }
}

/**
 * A chart with the caller-supplied id already exists in this project.
 *
 * The id is optional client input — a UI saving optimistically supplies its
 * own — so a collision is the caller's to act on: pick another id, or let the
 * server mint one. Mapping Prisma's unique-constraint failure here is what
 * keeps caller-controlled input from surfacing as an unknown 500.
 */
export class SavedWorkbenchChartAlreadyExistsError extends HandledError {
  declare readonly code: "saved_workbench_chart_already_exists";

  constructor() {
    super(
      "saved_workbench_chart_already_exists",
      "A saved chart with this id already exists.",
      {
        httpStatus: 409,
        fault: "customer",
        ...remediation("saved_workbench_chart_already_exists"),
      },
    );
    this.name = "SavedWorkbenchChartAlreadyExistsError";
  }
}

/**
 * The dashboard a chart was asked to be placed on does not exist in this
 * project.
 *
 * Covers both a foreign dashboard's id and one that never existed, and
 * deliberately does not distinguish them — the same reasoning as
 * {@link SavedWorkbenchChartNotFoundError}, applied to the id on the other
 * side of a placement. Derived from
 * {@link import("~/server/analytics/dashboardBelongsToProject").dashboardBelongsToProject},
 * the identical tenancy check `graphs.create` already runs before it places a
 * newly created chart.
 */
export class SavedWorkbenchChartDashboardNotFoundError extends HandledError {
  declare readonly code: "saved_workbench_chart_dashboard_not_found";

  constructor() {
    super("saved_workbench_chart_dashboard_not_found", "Dashboard not found.", {
      httpStatus: 404,
      fault: "customer",
      ...remediation("saved_workbench_chart_dashboard_not_found"),
    });
    this.name = "SavedWorkbenchChartDashboardNotFoundError";
  }
}

/**
 * The chart policy refused the specification on the way in.
 *
 * Refusing at write is what stops the database becoming a way around the
 * policy: a specification the workbench would not render must not become
 * renderable by being stored and read back.
 */
export class SavedWorkbenchChartSpecificationRefusedError extends HandledError {
  declare readonly code: "saved_workbench_chart_specification_refused";

  constructor(
    /** The policy's own structured refusals, in the order it found them. */
    errors: readonly VegaValidationError[],
  ) {
    super(
      "saved_workbench_chart_specification_refused",
      "The chart specification was refused by the visualization policy.",
      {
        httpStatus: 400,
        fault: "customer",
        // Named consumer: the specification editor, which points at the
        // offending part of the spec by JSON path rather than making the
        // member re-read the whole thing looking for it.
        meta: {
          errors: errors.map((error) => ({
            rule: error.rule,
            path: error.path,
            message: error.message,
          })),
        },
        ...remediation("saved_workbench_chart_specification_refused"),
      },
    );
    this.name = "SavedWorkbenchChartSpecificationRefusedError";
  }
}

/**
 * A stored definition does not match the versioned schema.
 *
 * `platform` fault and a 5xx on purpose. Every write goes through the service,
 * which parses before it stores, so a row that cannot be read back is something
 * this application got wrong — a hand-edited row, or a version skew a build
 * shipped without teaching the parser about. Charging it to the customer would
 * file a real defect as routine noise.
 */
export class SavedWorkbenchChartDefinitionInvalidError extends HandledError {
  declare readonly code: "saved_workbench_chart_definition_invalid";

  constructor(
    /** The chart whose definition could not be read. */
    chartId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super(
      "saved_workbench_chart_definition_invalid",
      "This saved chart's definition could not be read.",
      {
        httpStatus: 500,
        fault: "platform",
        meta: { chartId },
        ...remediation("saved_workbench_chart_definition_invalid"),
        ...options,
      },
    );
    this.name = "SavedWorkbenchChartDefinitionInvalidError";
  }
}

/**
 * Saved workbench charts and the custom-chart-playground are mutually
 * exclusive while the playground is experimental: with
 * `release_custom_chart_playground` ON for this project, `chart` REST/CLI
 * operations refuse rather than compete with `dashboard-widget` as two
 * answers to "make me a chart." `customer` fault, 403 — a product decision
 * an administrator can change, not an incident.
 *
 * The message NAMES the flag and the alternative deliberately: this is the
 * one caller-visible signal that stops an agent from retrying the same
 * command and pushes it toward `dashboard-widget` instead.
 */
export class SavedWorkbenchChartsDisabledForPlaygroundError extends HandledError {
  declare readonly code: "saved_workbench_charts_disabled_for_playground";

  constructor() {
    super(
      "saved_workbench_charts_disabled_for_playground",
      `Saved workbench charts are turned off for this project while the custom-chart-playground is enabled (feature flag: ${CUSTOM_CHART_PLAYGROUND_FLAG}). Do not retry — use the dashboard-widgets skill / \`langwatch dashboard-widget\` commands instead.`,
      {
        httpStatus: 403,
        ...remediation("saved_workbench_charts_disabled_for_playground"),
      },
    );
    this.name = "SavedWorkbenchChartsDisabledForPlaygroundError";
  }
}
