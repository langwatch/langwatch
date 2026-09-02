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
import { DashboardLayout } from "../../ui/sections/dashboard-layout";
import { NowProvider } from "@langwatch/suite-web";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { usePreloadDrawer } from "../../behavior/use-preload-drawer";
import { api } from "../../behavior/scenario-api";
import { AgentTestingHeader } from "./agent-testing-header";
import { AgentTestingCaseEditor } from "./cases/agent-testing-case-editor";
import { TestCasesTab } from "./cases/test-cases-tab";
import { ResultsTab } from "./results/results-tab";
import { useAgentTestingLiveUpdates } from "./use-agent-testing-live-updates";
import { useHydrateViewFromUrl } from "./use-agent-testing-page-flows";
import { useAgentTestingRouting } from "./use-agent-testing-routing";
import { useAgentTestingStore } from "./use-agent-testing-store";
import { ScenarioWorkflowHostBridge } from "../../ui/sections/workflow-host-bridge";

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
  return (
    <ScenarioWorkflowHostBridge>
      <AgentTestingBoard />
    </ScenarioWorkflowHostBridge>
  );
}

/**
 * The period control's host, bridged from this family's own.
 *
 * `PeriodSelector` is `@langwatch/analytics-web`'s and reads the address
 * through the workflow host it was published against. Mounted here, at the top
 * of the page, so the whole board sees one address and a test that mocks this
 * package's router mocks one router.
 */
function AgentTestingBoard() {
  const { project } = useOrganizationTeamProject();
  // The rows open a run's detail and the Test Runs list opens the run plan
  // editor, two separate downloads. Fetch them while the person reads the page.
  usePreloadDrawer("scenarioRunDetail", "agentTestingPlanEditor");

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
      </DashboardLayout>
    </NowProvider>
  );
}
