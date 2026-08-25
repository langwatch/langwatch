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
import { useCallback, useEffect, useRef, useState } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { ScenarioCreateModal } from "~/components/scenarios/ScenarioCreateModal";
import { NowProvider } from "~/components/suites/NowProvider";
import type { SimulationSuite } from "~/generated/prisma/client";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePreloadDrawer } from "~/hooks/usePreloadDrawer";
import { useScenarioTabFollow } from "~/hooks/useScenarioTabFollow";
import { useSimulationUpdateListener } from "~/hooks/useSimulationUpdateListener";
import type { ScenarioTabNavigatePayload } from "~/server/scenarios/browser-tab/scenario-tab-events";
import { getOnPlatformSetId } from "~/server/scenarios/internal-set-id";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { AgentTestingHeader } from "./AgentTestingHeader";
import { TestCasesTab } from "./cases/TestCasesTab";
import { useOpenLiveRun } from "./cases/useOpenLiveRun";
import { ResultsTab } from "./results/ResultsTab";
import { toAgentTestingRunPath } from "./results/run-plans";
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
  const [createCase, setCreateCase] = useState<{
    open: boolean;
    folderId: string | null;
  }>({ open: false, folderId: null });

  // The rail reads the same list, so this is the cached copy rather than a
  // second read. It is only here to turn the address of a suite into its id.
  const { data: folders } = api.suites.folders.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const selectedSuiteSlug =
    routing.selection.kind === "suite" ? routing.selection.slug : null;
  const selectedFolderId = selectedSuiteSlug
    ? (folders?.find((folder) => folder.slug === selectedSuiteSlug)?.id ?? null)
    : null;

  // The view mode is the one piece of view state the address carries, so a
  // shared link opens the results the way they were shared.
  const viewParam = router.query.view;
  useEffect(() => {
    if (!router.isReady) return;
    hydrateFromUrl(router.query);
  }, [router.isReady, viewParam, hydrateFromUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the SDK opened this tab, a later run from the same machine is steered
  // here instead of opening yet another browser tab. The address the handoff
  // carries names the v1 page, so it is read as the Agent Testing run it means.
  const scenarioTab = useScenarioTabFollow();
  const lastFollowedRef = useRef<string | null>(null);
  const followRun = useCallback(
    (payload: ScenarioTabNavigatePayload) => {
      const target = new URL(payload.url);
      if (target.origin !== window.location.origin) return;
      const path =
        toAgentTestingRunPath(target.pathname) ??
        target.pathname + target.search;
      if (path === window.location.pathname) return;
      // A handoff is parked as well as broadcast, so a tab that took the live
      // one and then re-subscribed is offered the same run again.
      if (lastFollowedRef.current === payload.url) return;
      lastFollowedRef.current = payload.url;
      void router.push(path);
    },
    [router],
  );

  // The same query keys the v1 page refreshes, so a person moving between the
  // two interfaces never reads a stale list. The connection state travels to
  // the results, where it decides whether the fallback polling runs at all.
  const { isConnected: sseConnected } = useSimulationUpdateListener({
    projectId: project?.id ?? "",
    refetch: () => {
      void utils.suites.getSummaries.invalidate();
      void utils.scenarios.getExternalSetSummaries.invalidate();
      // The run number of a plan counts the runs of the window. A run that
      // just finished makes that count one higher, and a stale count names
      // the new run after the one before it.
      void utils.scenarios.getScenarioSetBatchRunCount.invalidate();
    },
    enabled: !!project?.id,
    debounceMs: 500,
    tabKey: scenarioTab.tabKey,
    tabId: scenarioTab.tabId,
    onTabNavigate: followRun,
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

  const handleNewTestCase = useCallback(
    (folderId: string | null) => setCreateCase({ open: true, folderId }),
    [],
  );

  // Save and Run inside the case editor keeps the person on this page. The
  // run opens in the drawer instead of sending them to the v1 page.
  const { openLiveRun } = useOpenLiveRun();
  const setPendingBatchRunId = useAgentTestingStore(
    (state) => state.setPendingBatchRunId,
  );
  useEffect(() => {
    if (!project?.id) return;
    setFlowCallbacks("scenarioEditor", {
      onRunStarted: ({ batchRunId }: { batchRunId: string }) => {
        setPendingBatchRunId(batchRunId);
        void openLiveRun({
          batchRunId,
          scenarioSetId: getOnPlatformSetId(project.id),
        });
      },
    });
  }, [project?.id, setFlowCallbacks, setPendingBatchRunId, openLiveRun]);

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
              <ResultsTab sseConnected={sseConnected} />
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
