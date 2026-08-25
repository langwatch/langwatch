/**
 * Agent Testing: one page with the test cases and the results in tabs.
 *
 * The page is the only mount point of the live-run subscription and of the
 * case editor, and every move inside it is a shallow address push, so a run
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
import { useAgentTestingLiveUpdates } from "./useAgentTestingLiveUpdates";
import {
  useHydrateViewFromUrl,
  useNewRunPlanFlow,
} from "./useAgentTestingPageFlows";
import { useAgentTestingRouting } from "./useAgentTestingRouting";

/** How many test cases and how many run plans the tabs count. */
function useTabCounts(projectId: string) {
  const { data: scenarios } = api.scenarios.getAll.useQuery(
    { projectId },
    { enabled: !!projectId },
  );
  const { data: suites } = api.suites.getAll.useQuery(
    { projectId, kinds: ["custom", "folder"] },
    { enabled: !!projectId },
  );

  return { casesCount: scenarios?.length, plansCount: suites?.length };
}

export function AgentTestingPage() {
  const { project } = useOrganizationTeamProject();
  // The rows open a run's detail and the header opens the run plan editor,
  // two separate downloads. Fetch them while the person reads the page.
  usePreloadDrawer("scenarioRunDetail", "agentTestingPlanEditor");

  const routing = useAgentTestingRouting();
  useHydrateViewFromUrl();
  const { isSseConnected } = useAgentTestingLiveUpdates(project?.id ?? "");
  const handleNewRunPlan = useNewRunPlanFlow(routing.selectPlan);
  const { casesCount, plansCount } = useTabCounts(project?.id ?? "");

  return (
    <NowProvider>
      <DashboardLayout>
        <VStack width="full" height="full" gap={0}>
          <AgentTestingHeader
            tab={routing.tab}
            onTabChange={routing.setTab}
            onNewRunPlan={handleNewRunPlan}
            casesCount={casesCount}
            plansCount={plansCount}
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
      </DashboardLayout>
    </NowProvider>
  );
}
