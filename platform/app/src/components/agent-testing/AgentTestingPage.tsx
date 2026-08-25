/**
 * Agent Testing: one page with the test cases and the results in tabs.
 *
 * The page is the only mount point of the live-run subscription, and every
 * move inside it is a shallow address push, so a run keeps streaming while a
 * person moves between suites, plans and tabs.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */

import { Box, VStack } from "@chakra-ui/react";
import { useCallback, useState } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { ScenarioCreateModal } from "~/components/scenarios/ScenarioCreateModal";
import { NowProvider } from "~/components/suites/NowProvider";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePreloadDrawer } from "~/hooks/usePreloadDrawer";
import { AgentTestingHeader } from "./AgentTestingHeader";
import { TestCasesTab } from "./cases/TestCasesTab";
import { ResultsTab } from "./results/ResultsTab";
import { useAgentTestingLiveUpdates } from "./useAgentTestingLiveUpdates";
import {
  useHydrateViewFromUrl,
  useNewRunPlanFlow,
  useScenarioEditorRunFlow,
  useSelectedSuiteFolderId,
} from "./useAgentTestingPageFlows";
import { useAgentTestingRouting } from "./useAgentTestingRouting";

export function AgentTestingPage() {
  const { project } = useOrganizationTeamProject();
  // The rows open a run's detail, the rail opens the case editor and the
  // header opens the run plan editor, three separate downloads. Fetch them
  // while the person reads the page.
  usePreloadDrawer("scenarioRunDetail", "scenarioEditor", "suiteEditor");

  const routing = useAgentTestingRouting();
  const [createCase, setCreateCase] = useState<{
    open: boolean;
    folderId: string | null;
  }>({ open: false, folderId: null });

  const selectedFolderId = useSelectedSuiteFolderId(routing.selection);
  useHydrateViewFromUrl();
  const { isSseConnected } = useAgentTestingLiveUpdates(project?.id ?? "");
  const handleNewRunPlan = useNewRunPlanFlow(routing.selectPlan);
  useScenarioEditorRunFlow(project?.id);

  const handleNewTestCase = useCallback(
    (folderId: string | null) => setCreateCase({ open: true, folderId }),
    [],
  );

  return (
    <NowProvider>
      <DashboardLayout>
        <VStack width="full" height="full" gap={0}>
          <AgentTestingHeader
            tab={routing.tab}
            onTabChange={routing.setTab}
            onNewTestCase={() => handleNewTestCase(selectedFolderId)}
            onNewRunPlan={handleNewRunPlan}
          />

          <Box flex={1} width="full" minHeight={0} overflow="hidden">
            {routing.tab === "cases" ? (
              <TestCasesTab onNewTestCase={handleNewTestCase} />
            ) : (
              <ResultsTab isSseConnected={isSseConnected} />
            )}
          </Box>
        </VStack>

        <ScenarioCreateModal
          open={createCase.open}
          folderId={createCase.folderId}
          variant="agent-testing"
          onClose={() => setCreateCase({ open: false, folderId: null })}
        />
      </DashboardLayout>
    </NowProvider>
  );
}
