/**
 * Agent Testing: one page with the scenarios and the results in tabs.
 * @see specs/features/agent-testing/page-structure.feature
 */

import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { Box, VStack } from "@langwatch/design-system/primitives";

import { toRunPlanSuites } from "../../../behavior/agent-testing/results/run-plans.ts";
import { useAgentTestingLiveUpdates } from "../../../behavior/agent-testing/use-agent-testing-live-updates.ts";
import { useAgentTestingRouting } from "../../../behavior/agent-testing/use-agent-testing-routing.ts";
import { useAgentTestingStore } from "../../../behavior/agent-testing/use-agent-testing-store.ts";
import { useScenarios } from "../../../behavior/scenarios/use-scenarios.ts";
import { useSuites } from "../../../behavior/suites/use-suites.ts";
import { useTestSuites } from "../../../behavior/suites/use-test-suites.ts";
import { usePreloadDrawer } from "../../../behavior/use-preload-drawer.ts";
import { countCasesInSuites } from "../../../model/agent-testing/cases/test-cases.ts";
import { NowProvider } from "../../elements/suite/runs/now-provider.tsx";
import { AgentTestingHeader } from "./agent-testing-header.tsx";
import { AgentTestingCaseEditor } from "./cases/agent-testing-case-editor.tsx";
import { TestCasesTab } from "./cases/test-cases-tab.tsx";
import { ResultsTab } from "./results/results-tab.tsx";
import { RunPlanDialogHost } from "./run/run-plan-dialog-host.tsx";
import { useHydrateViewFromUrl } from "./use-agent-testing-page-flows.ts";

/**
 * How many scenarios and how many run plans the tabs count.
 */
function useTabCounts(projectId: string) {
  const { data: scenarios } = useScenarios({ projectId });
  const { data: testSuites } = useTestSuites({ projectId });
  const { data: suites } = useSuites({
    projectId,
    kinds: ["run_plan", "test_suite"],
  });

  return {
    // The rail lists suites; a scenario in none of them is reachable from no view.
    casesCount:
      scenarios && testSuites
        ? countCasesInSuites({ cases: scenarios, suiteIds: testSuites.map((suite) => suite.id) })
        : undefined,
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

  const header = (
    <AgentTestingHeader
      tab={routing.tab}
      onTabChange={routing.setTab}
      casesCount={casesCount}
      plansCount={plansCount}
      openPlan={routing.tab === "results" ? openPlanTitle : null}
    />
  );

  return (
    <NowProvider>
      {routing.tab === "cases" ? (
        <Box width="full" height="full" overflow="hidden">
          <TestCasesTab header={header} />
        </Box>
      ) : (
        <VStack width="full" height="full" gap={0}>
          {header}
          <Box flex={1} width="full" minHeight={0} overflow="hidden">
            <ResultsTab isSseConnected={isSseConnected} />
          </Box>
        </VStack>
      )}

      <AgentTestingCaseEditor />
      <RunPlanDialogHost />
    </NowProvider>
  );
}
