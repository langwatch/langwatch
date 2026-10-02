/**
 * Unified simulations page — the primary view for all simulation runs.
 */

import { useDrawer } from "@langwatch/browser-host/drawer";
import { showErrorToast } from "@langwatch/browser-host/errors";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box, EmptyState, HStack, VStack } from "@langwatch/design-system/primitives";
import { toaster } from "@langwatch/design-system/toaster";
import { scenarioClient } from "@langwatch/scenario-client";
import type { ScenarioTabNavigatePayload, SuiteRunSummary } from "@langwatch/scenario-contract";
import { fromDate, nowInstant, subDays } from "@langwatch/time";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HandledErrorAlert } from "../../../behavior/errors.tsx";
import { api, type SimulationSuite } from "../../../behavior/scenario-api.ts";
import { useRunSuite } from "../../../behavior/suites/use-run-suite.ts";
import {
  useExternalSetSummaries,
  useSuiteSummaries,
} from "../../../behavior/suites/use-set-summaries.ts";
import {
  ALL_RUNS_ID,
  extractExternalSetId,
  isExternalSetSelection,
  useSuiteRouting,
} from "../../../behavior/suites/use-suite-routing.ts";
import { useSuites } from "../../../behavior/suites/use-suites.ts";
import { usePreloadDrawer } from "../../../behavior/use-preload-drawer.ts";
import { useScenarioTabFollow } from "../../../behavior/use-scenario-tab-follow.ts";
import { useSimulationUpdateListener } from "../../../behavior/use-simulation-update-listener.ts";
import {
  type Period,
  PeriodSelector,
  usePeriodSelector,
} from "../../elements/analytics/period-selector.tsx";
import { SuiteArchiveDialog } from "../../elements/suite/dialogs/suite-archive-dialog.tsx";
import { SuiteContextMenu } from "../../elements/suite/dialogs/suite-context-menu.tsx";
import { SuiteRunConfirmationDialog } from "../../elements/suite/dialogs/suite-run-confirmation-dialog.tsx";
import { NowProvider } from "../../elements/suite/runs/now-provider.tsx";
import { ExternalSetDetailPanel } from "./external-set-detail-panel.tsx";
import { RunHistoryPanel } from "./run-history-panel.tsx";
import { SuiteDetailPanel, SuiteEmptyState } from "./suite-detail-panel.tsx";
import { SuiteSidebar } from "./suite-sidebar.tsx";

const expandedPeriodDays = (daysAgo: number): number => {
  if (daysAgo <= 30) return 30;
  if (daysAgo <= 90) return 90;
  return 365;
};

export default function SimulationsPage() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer, setFlowCallbacks } = useDrawer();
  // The rows open a run's detail and the sidebar opens the run plan editor,
  // both separate downloads. Fetch them while the person reads the runs, so
  // the click opens the drawer rather than a spinner.
  usePreloadDrawer("scenarioRunDetail", "suiteEditor");
  const utils = api.useUtils();
  const scenarioUtils = scenarioClient.useUtils();
  const { selectedSuiteSlug, navigateToSuite, highlightBatchId } = useSuiteRouting();

  const router = useRouter();
  useOpenRunFromUrl({ router, openDrawer });

  const urlPendingBatchId = useUrlPendingBatch(router);

  const { period, mode, setPeriod, setRelativePeriod } = usePeriodSelector(30);

  // State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    suiteId: string;
  } | null>(null);
  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);

  // Queries
  const { data: suites, isLoading, error } = useSuites({ projectId: project?.id });

  const { data: externalSets, isLoading: isExternalSetsLoading } = useExternalSetSummaries({
    projectId: project?.id,
    startDate: period.startDate.epochMilliseconds,
    endDate: period.endDate.epochMilliseconds,
  });

  const { data: suiteSummariesData } = useSuiteSummaries({
    projectId: project?.id,
    startDate: period.startDate.epochMilliseconds,
    endDate: period.endDate.epochMilliseconds,
  });

  // Connect the sidebar-level query to SSE events so new runs appear without
  // waiting for the 30s poll interval. Without this, the SSE listener only
  // lives inside RunHistoryPanel, leaving the sidebar query unreachable.
  // When the SDK opened this tab, later runs from the same machine are steered
  // here instead of spawning yet another browser tab.
  const scenarioTab = useScenarioTabFollow();
  const followRun = useFollowRun(router);

  useSimulationUpdateListener({
    projectId: project?.id ?? "",
    refetch: () => {
      void utils.suites.getSummaries.invalidate();
      void scenarioUtils.scenarios.getExternalSetSummaries.invalidate();
    },
    enabled: !!project?.id,
    debounceMs: 500,
    tabKey: scenarioTab.tabKey,
    tabId: scenarioTab.tabId,
    onTabNavigate: followRun,
  });

  const runSummaries = useMemo(() => {
    if (!suiteSummariesData) return undefined;
    return new Map<string, SuiteRunSummary>(Object.entries(suiteSummariesData));
  }, [suiteSummariesData]);

  const suiteNameMap = useMemo(() => suiteNamesById(suites), [suites]);

  const selectedSuite = useMemo(
    () => selectedSuiteOf({ slug: selectedSuiteSlug, suites }),
    [selectedSuiteSlug, suites],
  );

  const selectedExternalSetId = useMemo(
    () => selectedExternalSetIdOf(selectedSuiteSlug),
    [selectedSuiteSlug],
  );

  useExpandPeriodToSelection({
    selectedSuiteSlug,
    selectedSuite,
    externalSets,
    runSummaries,
    periodStartMs: period.startDate.epochMilliseconds,
    setPeriod,
  });

  const archiveTargetSuite = archiveConfirmId
    ? suites?.find((s) => s.id === archiveConfirmId)
    : null;

  // Mutations
  const archiveMutation = api.suites.archive.useMutation({
    onSuccess: () => {
      void utils.suites.getAll.invalidate();
      void utils.suites.getSummaries.invalidate();
      const archivedSuite = suites?.find((s) => s.id === archiveConfirmId);
      if (archivedSuite && archivedSuite.slug === selectedSuiteSlug) {
        navigateToSuite(ALL_RUNS_ID);
      }
      setArchiveConfirmId(null);
      toaster.create({
        title: "Run plan archived",
        type: "success",
      });
    },
    onError: (err) =>
      showErrorToast({
        error: err,
        fallbackTitle: "Couldn't archive run plan",
      }),
  });

  const duplicateMutation = api.suites.duplicate.useMutation({
    onSuccess: (data) => {
      void utils.suites.getAll.invalidate();
      navigateToSuite(data.slug);
      toaster.create({
        title: "Run plan duplicated",
        type: "success",
      });
    },
    onError: (err) =>
      showErrorToast({
        error: err,
        fallbackTitle: "Couldn't duplicate run plan",
      }),
  });

  const {
    requestRun,
    isPending: isRunPending,
    pendingBatchRunId,
    dialogProps: runDialogProps,
  } = useRunSuite({
    onRunScheduled: () => {
      void utils.suites.getSummaries.invalidate();
    },
    // Quick Run stays in place (issue #3363); the success toast's "View run"
    // action is the opt-in path to the run plan detail page.
    onViewRun: (suiteId) => {
      const suite = suites?.find((s) => s.id === suiteId);
      if (suite) navigateToSuite(suite.slug);
    },
  });

  // Handlers
  const handleSuiteSaved = useCallback(
    (suite: SimulationSuite) => {
      navigateToSuite(suite.slug);
    },
    [navigateToSuite],
  );

  const handleRunRequested = useCallback(
    (suite: SimulationSuite) => {
      navigateToSuite(suite.slug);
      requestRun(suite);
    },
    [navigateToSuite, requestRun],
  );

  const handleNewSuite = useCallback(() => {
    setFlowCallbacks("suiteEditor", {
      onSaved: handleSuiteSaved,
      onRunRequested: handleRunRequested,
    });
    openDrawer("suiteEditor");
  }, [openDrawer, setFlowCallbacks, handleSuiteSaved, handleRunRequested]);

  const handleEditSuite = useCallback(
    (suiteId: string) => {
      setFlowCallbacks("suiteEditor", {
        onSaved: handleSuiteSaved,
        onRunRequested: handleRunRequested,
      });
      openDrawer("suiteEditor", { urlParams: { suiteId } });
    },
    [openDrawer, setFlowCallbacks, handleSuiteSaved, handleRunRequested],
  );

  const handleRunSuite = useCallback(
    (suiteId: string) => {
      const suite = suites?.find((s) => s.id === suiteId);
      if (!suite) return;
      requestRun(suite);
    },
    [suites, requestRun],
  );

  const handleDuplicateSuite = useCallback(
    (suiteId: string) => {
      if (!project) return;
      duplicateMutation.mutate({ projectId: project.id, id: suiteId });
    },
    [project, duplicateMutation],
  );

  const handleArchiveSuite = useCallback(
    (suiteId: string) => {
      if (!project) return;
      setArchiveConfirmId(suiteId);
    },
    [project],
  );

  const confirmArchive = useCallback(() => {
    if (!project || !archiveConfirmId) return;
    archiveMutation.mutate({ projectId: project.id, id: archiveConfirmId });
  }, [project, archiveConfirmId, archiveMutation]);

  const handleContextMenu = useCallback((e: React.MouseEvent, suiteId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, suiteId });
  }, []);

  return (
    <NowProvider>
      <VStack width="full" height="full" gap={0}>
        {/* Top row: heading + buttons */}
        <PageLayout.Header withBorder={false}>
          <HStack justify="space-between" align="center" w="full">
            <PageLayout.Heading>Simulations</PageLayout.Heading>
            <HStack>
              <PeriodSelector
                period={period}
                mode={mode}
                setPeriod={setPeriod}
                setRelativePeriod={setRelativePeriod}
              />
              <PageLayout.HeaderButton onClick={handleNewSuite}>
                <Plus size={16} /> New Run Plan
              </PageLayout.HeaderButton>
            </HStack>
          </HStack>
        </PageLayout.Header>

        {/* Second row: sidebar + content box */}
        <HStack flex={1} width="full" gap={0} overflow="hidden" minHeight={0}>
          {/* Sidebar */}
          <SuiteSidebar
            projectSlug={project?.slug ?? ""}
            suites={suites ?? []}
            selectedSuiteSlug={selectedSuiteSlug}
            runSummaries={runSummaries}
            externalSets={externalSets ?? []}
            onSelectSuite={navigateToSuite}
            onRunSuite={handleRunSuite}
            onContextMenu={handleContextMenu}
            onNewSuite={handleNewSuite}
            isLoading={isLoading || isExternalSetsLoading}
          />

          {/* Content box */}
          <Box flex={1} height="full" minWidth={0} paddingBottom={3} paddingRight={4}>
            <Box
              height="full"
              width="full"
              borderRadius="lg"
              boxShadow="0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1), 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)"
              border="1px solid"
              borderColor="border.muted"
              background="bg.panel"
              overflow="auto"
            >
              <MainPanel
                error={error ?? null}
                selectedSuiteSlug={selectedSuiteSlug}
                selectedSuite={selectedSuite}
                selectedExternalSetId={selectedExternalSetId}
                isLoading={isLoading}
                onNewSuite={handleNewSuite}
                onEditSuite={handleEditSuite}
                onRunSuite={handleRunSuite}
                isRunning={isRunPending}
                pendingBatchRunId={pendingBatchRunId ?? urlPendingBatchId}
                period={period}
                suiteNameMap={suiteNameMap}
                highlightBatchId={highlightBatchId}
                connectedToLocalRun={!!scenarioTab.tabKey}
              />
            </Box>
          </Box>
        </HStack>
      </VStack>

      {/* Context menu */}
      {contextMenu && (
        <SuiteContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onEdit={() => handleEditSuite(contextMenu.suiteId)}
          onDuplicate={() => handleDuplicateSuite(contextMenu.suiteId)}
          onArchive={() => handleArchiveSuite(contextMenu.suiteId)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Archive confirmation dialog */}
      <SuiteArchiveDialog
        open={!!archiveConfirmId}
        onClose={() => setArchiveConfirmId(null)}
        onConfirm={confirmArchive}
        suiteName={archiveTargetSuite?.name ?? ""}
        isLoading={archiveMutation.isPending}
      />

      {/* Run confirmation dialog */}
      <SuiteRunConfirmationDialog {...runDialogProps} />
    </NowProvider>
  );
}

function MainPanel({
  error,
  selectedSuiteSlug,
  selectedSuite,
  selectedExternalSetId,
  isLoading,
  onNewSuite,
  onEditSuite,
  onRunSuite,
  isRunning,
  pendingBatchRunId,
  period,
  suiteNameMap,
  highlightBatchId,
  connectedToLocalRun,
}: {
  error: unknown;
  selectedSuiteSlug: string | null;
  selectedSuite: SimulationSuite | null;
  selectedExternalSetId: string | null;
  isLoading: boolean;
  onNewSuite: () => void;
  onEditSuite: (id: string) => void;
  onRunSuite: (id: string) => void;
  isRunning: boolean;
  pendingBatchRunId: string | null;
  period: Period;
  suiteNameMap: Map<string, string>;
  highlightBatchId: string | null;
  connectedToLocalRun: boolean;
}) {
  if (error) {
    // The alert is the page's whole error surface: one component that reads
    // the handled payload, an authored non-5xx message, or the generic unknown
    // state, and carries the tips, docs link and copyable error id with it.
    return (
      <EmptyState.Root paddingY={12}>
        <EmptyState.Content>
          <Box maxWidth="420px" width="100%">
            <HandledErrorAlert error={error} fallbackTitle="Couldn't load simulations" />
          </Box>
        </EmptyState.Content>
      </EmptyState.Root>
    );
  }

  if (selectedSuiteSlug === null) {
    return null;
  }

  if (selectedExternalSetId) {
    return (
      <ExternalSetDetailPanel
        scenarioSetId={selectedExternalSetId}
        period={period}
        highlightBatchId={highlightBatchId}
        connectedToLocalRun={connectedToLocalRun}
      />
    );
  }

  if (selectedSuiteSlug === ALL_RUNS_ID) {
    return (
      <RunHistoryPanel
        period={period}
        suiteNameMap={suiteNameMap}
        pendingBatchRunId={pendingBatchRunId}
        highlightBatchId={highlightBatchId}
      />
    );
  }

  if (selectedSuite) {
    return (
      <SuiteDetailPanel
        suite={selectedSuite}
        onEdit={() => onEditSuite(selectedSuite.id)}
        onRun={() => onRunSuite(selectedSuite.id)}
        isRunning={isRunning}
        pendingBatchRunId={pendingBatchRunId}
        period={period}
        highlightBatchId={highlightBatchId}
      />
    );
  }

  // Suite slug specified but suite object not yet loaded — wait for suites.getAll
  if (isLoading) {
    return null;
  }

  return <SuiteEmptyState onNewSuite={onNewSuite} />;
}

type BoardRouter = ReturnType<typeof useRouter>;

/** Opens a run's detail when redirected here from the old individual run URL. */
function useOpenRunFromUrl({
  router,
  openDrawer,
}: {
  router: BoardRouter;
  openDrawer: ReturnType<typeof useDrawer>["openDrawer"];
}) {
  useEffect(() => {
    if (!router.isReady) return;
    const openRunId = router.query.openRun;
    if (typeof openRunId === "string" && openRunId) {
      openDrawer("scenarioRunDetail", {
        urlParams: { scenarioRunId: openRunId },
      });
      // Remove the query param to avoid re-opening on navigation
      const { openRun: _, ...restQuery } = router.query;
      void router.replace(
        { pathname: router.pathname, query: restQuery },
        {
          shallow: true,
        },
      );
    }
  }, [router.isReady]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The batch a "Save and Run" redirect asked this page to show as pending. */
function useUrlPendingBatch(router: BoardRouter): string | null {
  const [urlPendingBatchId, setUrlPendingBatchId] = useState<string | null>(null);
  useEffect(() => {
    if (!router.isReady) return;
    const pendingBatch = router.query.pendingBatch;
    if (typeof pendingBatch === "string" && pendingBatch) {
      setUrlPendingBatchId(pendingBatch);
      // Remove the query param to keep URL clean
      const { pendingBatch: _, ...restQuery } = router.query;
      void router.replace(
        { pathname: router.pathname, query: restQuery },
        {
          shallow: true,
        },
      );
    }
  }, [router.isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  return urlPendingBatchId;
}

/** Steers this tab to a run the SDK started from the same machine, once per run. */
function useFollowRun(router: BoardRouter) {
  const lastFollowedRef = useRef<string | null>(null);

  return useCallback(
    (payload: ScenarioTabNavigatePayload) => {
      const target = new URL(payload.url);
      if (target.origin !== window.location.origin) return;
      if (target.pathname === window.location.pathname) return;
      // A handoff is parked as well as broadcast, so a tab that took the live
      // one and then re-subscribed is offered the same run again. Without this
      // it would be yanked back to a run the user had already moved on from.
      if (lastFollowedRef.current === payload.url) return;
      lastFollowedRef.current = payload.url;

      // Silently: the user started the run themselves, the page moving to it
      // is the expected outcome, not news. The connected badge in the set
      // header is the only marker that this tab behaves this way.
      void router.push(target.pathname + target.search);
    },
    [router],
  );
}

/** Widens the period when the selected plan or set last ran before its start. */
function useExpandPeriodToSelection({
  selectedSuiteSlug,
  selectedSuite,
  externalSets,
  runSummaries,
  periodStartMs,
  setPeriod,
}: {
  selectedSuiteSlug: string | null | undefined;
  selectedSuite: SimulationSuite | null | undefined;
  externalSets: { scenarioSetId: string; lastRunTimestamp?: number | null }[] | undefined;
  runSummaries: Map<string, SuiteRunSummary> | undefined;
  periodStartMs: number;
  setPeriod: ReturnType<typeof usePeriodSelector>["setPeriod"];
}) {
  useEffect(() => {
    if (!selectedSuiteSlug || selectedSuiteSlug === ALL_RUNS_ID) return;

    let lastRunTs: number | null = null;
    if (isExternalSetSelection(selectedSuiteSlug) && externalSets) {
      const setId = extractExternalSetId(selectedSuiteSlug);
      lastRunTs = externalSets.find((s) => s.scenarioSetId === setId)?.lastRunTimestamp ?? null;
    } else if (selectedSuite && runSummaries) {
      lastRunTs = runSummaries.get(selectedSuite.id)?.lastRunTimestamp ?? null;
    }

    if (lastRunTs && lastRunTs < periodStartMs) {
      const now = nowInstant();
      const daysAgo = Math.ceil((now.epochMilliseconds - lastRunTs) / 86400000);
      setPeriod(fromDate(subDays(now.epochMilliseconds, expandedPeriodDays(daysAgo))), now);
    }
  }, [selectedSuiteSlug]); // eslint-disable-line react-hooks/exhaustive-deps
}

function suiteNamesById(suites: { id: string; name: string }[] | undefined): Map<string, string> {
  return new Map((suites ?? []).map((suite) => [suite.id, suite.name]));
}

/** The run plan the route names; none for "all runs" or an external set. */
function selectedSuiteOf({
  slug,
  suites,
}: {
  slug: string | null | undefined;
  suites: SimulationSuite[] | undefined;
}): SimulationSuite | null {
  if (!slug || slug === ALL_RUNS_ID) return null;
  if (isExternalSetSelection(slug)) return null;
  return suites?.find((s) => s.slug === slug) ?? null;
}

function selectedExternalSetIdOf(slug: string | null | undefined): string | null {
  if (!slug || !isExternalSetSelection(slug)) return null;
  return extractExternalSetId(slug);
}
