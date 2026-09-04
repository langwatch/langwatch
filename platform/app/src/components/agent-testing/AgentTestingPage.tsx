/**
 * Agent Testing: one page with the scenarios and the results in tabs.
 *
 * The page is the only mount point of the live-run subscription and of the
 * scenario editor, and every move inside it is a shallow address push, so a run
 * keeps streaming while a person moves between suites, plans and tabs.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */

import { Box, VStack } from "@chakra-ui/react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { NowProvider } from "~/components/suites/NowProvider";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePreloadDrawer } from "~/hooks/usePreloadDrawer";
import { api } from "~/utils/api";
import { AgentTestingHeader } from "./AgentTestingHeader";
import { AgentTestingCaseEditor } from "./cases/AgentTestingCaseEditor";
import { TestCasesTab } from "./cases/TestCasesTab";
import { ResultsTab } from "./results/ResultsTab";
import { toRunPlanSuites } from "./results/run-plans";
import { RunPlanDialogHost } from "./run/RunPlanDialogHost";
import { useAgentTestingLiveUpdates } from "./useAgentTestingLiveUpdates";
import { useHydrateViewFromUrl } from "./useAgentTestingPageFlows";
import { useAgentTestingRouting } from "./useAgentTestingRouting";
import { useAgentTestingStore } from "./useAgentTestingStore";

/**
 * How many scenarios and how many run plans the tabs count.
 *
 * Both kinds of suite are read, because the read is shared with the Results
 * tab, but only the run plans are counted: a test suite is a group of
 * scenarios and never a row of the Test Runs list, so counting it put a number
 * beside "Results" that no row under it accounted for.
 */
function useTabCounts(projectId: string) {
  const { data: scenarios } = api.scenarios.getAll.useQuery(
    { projectId },
    { enabled: !!projectId },
  );
  const { data: suites } = api.suites.getAll.useQuery(
    { projectId, kinds: ["run_plan", "test_suite"] },
    { enabled: !!projectId },
  );

  return {
    casesCount: scenarios?.length,
    plansCount: suites ? toRunPlanSuites(suites).length : undefined,
  };
}

export function AgentTestingPage() {
  const { project } = useOrganizationTeamProject();
  // The rows open a run's detail; fetch it while the person reads the page.
  usePreloadDrawer("scenarioRunDetail");

  const routing = useAgentTestingRouting();
  useHydrateViewFromUrl();
  const { isSseConnected } = useAgentTestingLiveUpdates(project?.id ?? "");
  const { casesCount, plansCount } = useTabCounts(project?.id ?? "");
  const openPlanTitle = useAgentTestingStore((state) => state.openPlanTitle);

  return (
    <NowProvider>
      <DashboardLayout>
        <VStack width="full" height="full" gap={0}>
          <AgentTestingHeader
            tab={routing.tab}
            onTabChange={routing.setTab}
            casesCount={casesCount}
            plansCount={plansCount}
            openPlan={routing.tab === "results" ? openPlanTitle : null}
          />

          <Box flex={1} width="full" minHeight={0} overflow="hidden">
            {routing.tab === "cases" ? (
              <TestCasesTab />
            ) : (
              <ResultsTab isSseConnected={isSseConnected} />
            )}
          </Box>
        </VStack>

        <AgentTestingCaseEditor />
        <RunPlanDialogHost />
      </DashboardLayout>
    </NowProvider>
  );
}
