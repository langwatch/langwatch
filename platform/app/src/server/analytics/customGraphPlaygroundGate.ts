/**
 * The classic dashboard graph builder (`langwatch graph`) — the write-gate
 * that keeps it from competing with the custom-chart-playground.
 *
 * Unlike saved workbench charts, the graph builder is not itself an
 * experimental feature: every project has always been able to read and
 * render its `CustomGraph` rows, flag or no flag. Only writes that define or
 * redefine a graph's chart are gated here, so existing dashboards keep
 * rendering regardless of the flag — narrower than
 * `SavedWorkbenchChartsDisabledForPlaygroundError`'s gate on the whole
 * surface, which is fine to be wider because saved workbench charts are
 * behind their own experimental flag already.
 *
 * @see ~/server/analytics/saved-workbench-charts/errors.ts — the sibling gate this mirrors
 */
import { HandledError } from "@langwatch/handled-error";

import type { PrismaClient } from "~/generated/prisma/client";
import {
  CUSTOM_CHART_PLAYGROUND_FLAG,
  customChartPlaygroundEnabled,
} from "~/server/analytics/dashboard-widgets/access";
import { remediation } from "~/server/app-layer/error-remediation";

/**
 * Creating or editing a dashboard graph is refused while the
 * custom-chart-playground is enabled for this project.
 *
 * `customer` fault, 403 — a product decision an administrator can change,
 * not an incident. The message NAMES the flag and the alternative
 * deliberately: this is the third chart-creation surface (after `chart` and
 * `dashboard-widget`), and the one caller-visible signal that stops an
 * agent from retrying `graph` and pushes it toward `dashboard-widget`
 * instead.
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
 * Throws {@link CustomGraphWritesDisabledForPlaygroundError} when the
 * playground is enabled for this project. Call from a write that defines a
 * graph's chart — create and update — never from a read: existing graphs
 * must keep rendering regardless of the flag.
 */
export async function assertCustomGraphWritesAllowed({
  prisma,
  projectId,
}: {
  prisma: PrismaClient;
  projectId: string;
}): Promise<void> {
  const playgroundEnabled = await customChartPlaygroundEnabled({
    prisma,
    projectId,
  });
  if (playgroundEnabled) {
    throw new CustomGraphWritesDisabledForPlaygroundError();
  }
}
