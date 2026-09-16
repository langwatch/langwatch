/**
 * The classic dashboard graph builder (`langwatch graph`) — the write-gate
 * keeping it from competing with the custom-chart-playground. Only writes
 * that define/redefine a chart are gated; reads always render regardless.
 * @see ~/server/analytics/saved-workbench-charts/errors.ts — the sibling gate this mirrors
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { HandledError, remediation } from "@langwatch/handled-error";
import type { ProjectApi } from "@langwatch/project-contract";

import {
  CUSTOM_CHART_PLAYGROUND_FLAG,
  customChartPlaygroundEnabled,
} from "./dashboard-widgets/access.ts";

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
 * Throws {@link CustomGraphWritesDisabledForPlaygroundError} when the
 * playground is enabled. Call from a create/update write only — never a
 * read, since existing graphs must keep rendering regardless of the flag.
 */
export async function assertCustomGraphWritesAllowed({
  featureFlags,
  projects,
  projectId,
}: {
  featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  projects: Pick<ProjectApi, "findOrganizationId">;
  projectId: string;
}): Promise<void> {
  const playgroundEnabled = await customChartPlaygroundEnabled({
    featureFlags,
    projects,
    projectId,
  });
  if (playgroundEnabled) {
    throw new CustomGraphWritesDisabledForPlaygroundError();
  }
}
