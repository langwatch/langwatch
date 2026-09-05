/**
 * Agent Testing: one page with the scenarios and the results in tabs.
 * @see specs/features/agent-testing/page-structure.feature
 */

import { Box, VStack } from "@chakra-ui/react";
import { DashboardLayout } from "../dashboard-layout";
import { NowProvider } from "@langwatch/suite-web";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import { usePreloadDrawer } from "../../../behavior/use-preload-drawer";
import { api } from "../../../behavior/scenario-api";
import { AgentTestingHeader } from "./agent-testing-header";
import { AgentTestingCaseEditor } from "./cases/agent-testing-case-editor";
import { TestCasesTab } from "./cases/test-cases-tab";
import { ResultsTab } from "./results/results-tab";
import { useAgentTestingLiveUpdates } from "../../../behavior/agent-testing/use-agent-testing-live-updates";
import { useHydrateViewFromUrl } from "./use-agent-testing-page-flows";
import { useAgentTestingRouting } from "../../../behavior/agent-testing/use-agent-testing-routing";
import { useAgentTestingStore } from "./use-agent-testing-store";
import { ScenarioWorkflowHostBridge } from "../workflow-host-bridge";
import { toRunPlanSuites } from "../../../behavior/agent-testing/results/run-plans";
import { RunPlanDialogHost } from "./run/run-plan-dialog-host";

/**
 * How many scenarios and how many run plans the tabs count.
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
  return (
    <ScenarioWorkflowHostBridge>
      <AgentTestingBoard />
    </ScenarioWorkflowHostBridge>
  );
}

/**
 * The period control's host, bridged from this family's own.
 */
function AgentTestingBoard() {
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
