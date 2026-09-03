import type { PlatformUrlBuilder } from "@langwatch/api/rest";
import type { ScenarioRunPlatformUrlBuilder } from "@langwatch/scenario-server";
import { scenarioRunPath } from "@langwatch/suite-contract";

/**
 * The platform's own address for ONE scenario run: the results of the
 * interface the project reads, with the `scenarioRunDetail` drawer open on
 * that run, the same address the app's own UI produces via
 * `openDrawer("scenarioRunDetail", { scenarioRunId })` (see `ScenarioChip`).
 * This lands the user on the run's own detail, NOT the external-set page whose
 * title is the opaque internal suite id (the old
 * `/simulations/{set}/{batch}?openRun=` form did the latter).
 *
 * The drawer address needs ONLY the run id: every run has an id, so every run
 * gets a precise address, and there is no set or batch to resolve first.
 *
 * See specs/langy/langy-agent-driven-navigation.feature, Rule "The platform's
 * link for a resource addresses that resource, not an index".
 */
export function createScenarioRunPlatformUrlBuilder(
  platformUrl: PlatformUrlBuilder,
): ScenarioRunPlatformUrlBuilder {
  return ({ projectSlug, scenarioRunId }) =>
    platformUrl({
      projectSlug,
      // The Simulations pages: the interface every project can open. Agent
      // Testing addresses the same run under `/agent-testing/results`, and
      // which one a project reads is a flag read this builder has no port
      // for yet — see `TestingInterfaceReader` in `@langwatch/suite-contract`.
      path: scenarioRunPath({ ui: "simulations", scenarioRunId }),
    });
}
