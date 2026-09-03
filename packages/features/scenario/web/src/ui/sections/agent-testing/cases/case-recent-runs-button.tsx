/**
 * The way into a recent run of the scenario being edited, in the header of the
 * editor drawer beside its version.
 *
 * It offers the same list the line above the table offers, narrowed to this one
 * scenario, so a person reading a scenario can see what it last did without
 * leaving the editor to look for it.
 *
 * Whether the scenario ran at all is one scoped read, so the button can be off
 * with a reason rather than opening onto an empty list. The runs themselves are
 * still read only once the list is opened.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { usePeriodSelector } from "@langwatch/analytics-web/components/PeriodSelector";
import { useDrawer } from "@langwatch/ui-drawer";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { api } from "../../../../behavior/scenario-api";
import { RecentRunsMenu } from "./recent-runs-menu";

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

  const { data: lastResults } = api.scenarios.getLastResultSummaries.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioIds: [scenarioId],
      startDate: period.startDate.getTime(),
      endDate: period.endDate.getTime(),
    },
    { enabled: !!project },
  );

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
