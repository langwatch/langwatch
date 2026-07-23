import { platformUrl } from "../shared/platform-url";

/**
 * The platform's own address for ONE scenario run.
 *
 * A run opens in the `scenarioRunDetail` drawer on the base simulations route —
 * `/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId={runId}` —
 * the same address the app's own UI produces via
 * `openDrawer("scenarioRunDetail", { scenarioRunId })` (see `ScenarioChip`).
 * This lands the user on the run's own detail, NOT the external-set page whose
 * title is the opaque internal suite id (the old
 * `/simulations/{set}/{batch}?openRun=` form did the latter).
 *
 * The drawer address needs ONLY the run id — unlike the old nested form there
 * is no `scenarioSetId`/`batchRunId` to resolve and no index fallback: every
 * run has an id, so every run gets a precise address. Callers that used to
 * resolve a set/batch for this no longer need to.
 *
 * See specs/langy/langy-agent-driven-navigation.feature, Rule "The platform's
 * link for a resource addresses that resource, not an index".
 */
export function scenarioRunPlatformUrl({
  projectSlug,
  scenarioRunId,
}: {
  projectSlug: string;
  scenarioRunId: string;
}): string {
  return platformUrl({
    projectSlug,
    path: `/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=${encodeURIComponent(
      scenarioRunId,
    )}`,
  });
}
