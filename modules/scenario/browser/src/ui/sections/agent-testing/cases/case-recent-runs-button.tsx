/**
 * The way into a recent run of the scenario being edited, in the header of the editor
 * drawer beside its version.
 * @see specs/features/agent-testing/cases-table.feature
 */

import { useDrawer } from "@langwatch/browser-host/drawer";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";

import { useLastResultSummaries } from "../../../../behavior/scenarios/use-last-result-summaries.ts";
import { usePeriodSelector } from "../../../elements/analytics/period-selector.tsx";
import { RecentRunsMenu } from "./recent-runs-menu.tsx";

/** Why the button is off on a scenario that has never run. */
export const NO_RUN_YET_HINT = "This scenario has not run yet.";

/** How far back the editor looks, which is what the page looks back by default. */
const DEFAULT_PERIOD_DAYS = 30;

export function CaseRecentRunsButton({ scenarioId }: { scenarioId: string }) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();
  // The picker reads the address, so the editor looks over the window the page
  // behind it is on.
  const { period } = usePeriodSelector(DEFAULT_PERIOD_DAYS);

  const { data: lastResults } = useLastResultSummaries({
    projectId: project?.id,
    scenarioIds: [scenarioId],
    startDate: period.startDate.epochMilliseconds,
    endDate: period.endDate.epochMilliseconds,
  });

  return (
    <RecentRunsMenu
      period={period}
      scenarioIds={[scenarioId]}
      hasRun={(lastResults ?? []).length > 0}
      emptyHint={NO_RUN_YET_HINT}
      // A run opens on the Results tab, so the editor gets out of the way
      // rather than staying open over the run it just sent the reader to.
      onChosen={closeDrawer}
    />
  );
}
