/**
 * Agent Testing: one page with the test cases and the results in tabs.
 *
 * The page is the only mount point of the live-run subscription, and every
 * move inside it is a shallow address push, so a run keeps streaming while a
 * person moves between suites, plans and tabs.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */

import { Box, Center, HStack, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { ScenarioCreateModal } from "~/components/scenarios/ScenarioCreateModal";
import { NowProvider } from "~/components/suites/NowProvider";
import type { SimulationSuite } from "~/generated/prisma/client";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePreloadDrawer } from "~/hooks/usePreloadDrawer";
import { useSimulationUpdateListener } from "~/hooks/useSimulationUpdateListener";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { AgentTestingHeader } from "./AgentTestingHeader";
import { ResultsTab } from "./results/ResultsTab";
import { useAgentTestingRouting } from "./useAgentTestingRouting";
import { useAgentTestingStore } from "./useAgentTestingStore";

export function AgentTestingPage() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const utils = api.useUtils();
  const { openDrawer, setFlowCallbacks } = useDrawer();
  // The rows open a run's detail, the rail opens the case editor and the
  // header opens the run plan editor, three separate downloads. Fetch them
  // while the person reads the page.
  usePreloadDrawer("scenarioRunDetail", "scenarioEditor", "suiteEditor");

  const routing = useAgentTestingRouting();
  const hydrateFromUrl = useAgentTestingStore((state) => state.hydrateFromUrl);
  const [createCaseOpen, setCreateCaseOpen] = useState(false);

  // The view mode is the one piece of view state the address carries, so a
  // shared link opens the results the way they were shared.
  const viewParam = router.query.view;
  useEffect(() => {
    if (!router.isReady) return;
    hydrateFromUrl(router.query);
  }, [router.isReady, viewParam, hydrateFromUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // The same query keys the v1 page refreshes, so a person moving between the
  // two interfaces never reads a stale list. The connection state travels to
  // the results, where it decides whether the fallback polling runs at all.
  const { isConnected: sseConnected } = useSimulationUpdateListener({
    projectId: project?.id ?? "",
    refetch: () => {
      void utils.suites.getSummaries.invalidate();
      void utils.scenarios.getExternalSetSummaries.invalidate();
    },
    enabled: !!project?.id,
    debounceMs: 500,
  });

  const { selectPlan } = routing;
  const handleSuiteSaved = useCallback(
    (suite: SimulationSuite) => {
      selectPlan(suite.slug);
    },
    [selectPlan],
  );

  const handleNewRunPlan = useCallback(() => {
    setFlowCallbacks("suiteEditor", { onSaved: handleSuiteSaved });
    openDrawer("suiteEditor");
  }, [openDrawer, setFlowCallbacks, handleSuiteSaved]);

  const handleNewTestCase = useCallback(() => setCreateCaseOpen(true), []);

  return (
    <NowProvider>
      <DashboardLayout>
        <VStack width="full" height="full" gap={0}>
          <AgentTestingHeader
            tab={routing.tab}
            onTabChange={routing.setTab}
            onNewTestCase={handleNewTestCase}
            onNewRunPlan={handleNewRunPlan}
          />

          <Box flex={1} width="full" minHeight={0} overflow="hidden">
            {routing.tab === "cases" ? (
              <TestCasesShell />
            ) : (
              <ResultsTab sseConnected={sseConnected} />
            )}
          </Box>
        </VStack>

        <ScenarioCreateModal
          open={createCaseOpen}
          onClose={() => setCreateCaseOpen(false)}
        />
      </DashboardLayout>
    </NowProvider>
  );
}

/**
 * The frame of the Test cases tab: the suites rail beside the cases table.
 * Both halves land with the rail and the table.
 */
function TestCasesShell() {
  return (
    <HStack
      width="full"
      height="full"
      gap={0}
      alignItems="stretch"
      data-testid="agent-testing-cases-tab"
    >
      <Box
        width="260px"
        flexShrink={0}
        borderRightWidth="1px"
        borderColor="border"
        data-testid="agent-testing-suite-rail"
      />
      <Box
        flex={1}
        minWidth={0}
        padding={4}
        data-testid="agent-testing-cases-panel"
      >
        <PlaceholderNote>The test cases land here.</PlaceholderNote>
      </Box>
    </HStack>
  );
}

function PlaceholderNote({ children }: { children: React.ReactNode }) {
  return (
    <Center height="full">
      <Text fontSize="sm" color="fg.muted">
        {children}
      </Text>
    </Center>
  );
}
