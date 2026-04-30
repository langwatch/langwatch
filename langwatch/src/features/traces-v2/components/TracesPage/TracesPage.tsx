import { Box, Flex, HStack, VStack } from "@chakra-ui/react";
import React, { useMemo } from "react";
import { ExportConfigDialog } from "~/components/messages/ExportConfigDialog";
import { ExportProgress } from "~/components/messages/ExportProgress";
import { useTracesV2Presence } from "~/features/presence/hooks/useTracesV2Presence";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useLensFilterDirtySync } from "../../hooks/useLensFilterDirtySync";
import { useProjectHasTraces } from "../../hooks/useProjectHasTraces";
import { useResetSelectionOnViewChange } from "../../hooks/useResetSelectionOnViewChange";
import { useRollingTimeRange } from "../../hooks/useRollingTimeRange";
import { useTraceFreshness } from "../../hooks/useTraceFreshness";
import { useTraceListExport } from "../../hooks/useTraceListExport";
import { useTraceListQuery } from "../../hooks/useTraceListQuery";
import { useURLSync } from "../../hooks/useURLSync";
import { OnboardingHost } from "../../onboarding";
import { useOnboardingStore } from "../../onboarding/store/onboardingStore";
import {
  SELECT_ALL_MATCHING_CAP,
  useSelectionStore,
} from "../../stores/selectionStore";
import { useUIStore } from "../../stores/uiStore";
import { DensityProvider } from "../DensityProvider";
import { FilterSidebar } from "../FilterSidebar/FilterSidebar";
import { FindBar } from "../FindBar";
import { SearchBar } from "../SearchBar/SearchBar";
import { BulkActionBar } from "../Toolbar/BulkActionBar";
import { Toolbar } from "../Toolbar/Toolbar";
import { TraceTable } from "../TraceTable/TraceTable";
import { EmptyResultsPane } from "./EmptyResultsPane";
import { PageKeyboardShortcuts } from "./PageKeyboardShortcuts";
import { useDebouncedFilterCommit } from "./useDebouncedFilterCommit";
import {
  useClearSelectionShortcut,
  useDensityToggleShortcut,
  useFindShortcut,
  useShortcutsHelpShortcut,
  useSidebarShortcut,
} from "./useKeyboardShortcuts";
import { useTracesPageTitle } from "./usePageTitle";

const SIDEBAR_WIDTH_EXPANDED = "220px";
const SIDEBAR_WIDTH_COLLAPSED = "40px";

const DIMMED_PROPS = {
  opacity: 0.45,
  pointerEvents: "none" as const,
  "aria-disabled": true,
  // `inert` keeps focus, hover, and pointer interactions out of the chrome
  // while the empty-state body is what the user should be touching.
  // React types lag the DOM property, so we widen via a record cast at the
  // call sites that compose this object.
  inert: "",
};

export const TracesPage: React.FC = () => {
  useURLSync();
  useRollingTimeRange();
  useTraceFreshness();
  useTracesV2Presence();
  useDebouncedFilterCommit();
  useLensFilterDirtySync();
  useSidebarShortcut();
  useFindShortcut();
  useShortcutsHelpShortcut();
  useDensityToggleShortcut();
  useClearSelectionShortcut();
  useResetSelectionOnViewChange();
  useTracesPageTitle();

  const { project } = useOrganizationTeamProject();
  const { hasAnyTraces } = useProjectHasTraces();
  const setupDismissedByProject = useOnboardingStore(
    (s) => s.setupDismissedByProject,
  );
  const setupDisengaged = useOnboardingStore((s) => s.setupDisengaged);
  const tourActive = useOnboardingStore((s) => s.tourActive);
  const setupDismissed = project
    ? !!setupDismissedByProject[project.id]
    : false;
  // Read the onboarding stage at the top level so we can decide
  // whether to surface the FilterSidebar even while the empty
  // state is technically "active". The slice chapter
  // (`serviceSegue` + `facetsReveal`) and the `outro` chapter want
  // the sidebar visible — slice teaches it, outro is the
  // victory-lap chapter where the user is dropping into the real
  // product.
  const topLevelOnboardingStage = useOnboardingStore((s) => s.stage);
  const sidebarVisibleDuringEmpty =
    topLevelOnboardingStage === "serviceSegue" ||
    topLevelOnboardingStage === "facetsReveal" ||
    topLevelOnboardingStage === "outro";
  // Empty state shows when the project hasn't received a real trace
  // *and* the user hasn't persistently dismissed the card for this
  // project. The dismissal is per-project + localStorage-backed, so
  // clicking Skip / Learn / completing the sample-data countdown
  // sticks across reloads. The toolbar's Continue integration clears
  // the dismissal when the user wants to come back.
  // Tour mode is an explicit override: existing customers
  // (`firstMessage=true`, real data in the table) hit the toolbar's
  // Tour button and we drop them into the empty-state journey on
  // top of their real project. The dismissal flag still wins —
  // clicking "Done exploring" exits cleanly. Without the override
  // the journey would only ever fire for genuinely-empty projects.
  const showEmptyState =
    !setupDismissed && (hasAnyTraces === false || tourActive);
  // Dim the surrounding chrome only while the card is *active*. The
  // moment the user clicks any exit action (Load sample / Skip / Learn)
  // `setupDisengaged` flips and the dim lifts — even if the card itself
  // is still finishing its post-send countdown animation.
  const dimChrome = showEmptyState && !setupDisengaged;

  return (
    <DensityProvider>
      {/* OnboardingHost lazy-mounts the body stage attribute + the
          drawer/sidebar glow `<style>` only while onboarding is
          active. When inactive it returns its children verbatim so
          users not in the journey ship zero onboarding DOM nodes. */}
      <OnboardingHost>
        <VStack
          width="full"
          height="full"
          gap={0}
          overflow="hidden"
          bg="bg.surface"
          role="application"
          aria-label="Trace explorer"
          position="relative"
        >
          <Box
            role="search"
            aria-label="Trace search"
            width="full"
            {...(dimChrome ? (DIMMED_PROPS as Record<string, unknown>) : {})}
          >
            <SearchBar />
          </Box>

          <HStack
            flex={1}
            align="stretch"
            width="full"
            gap={0}
            overflow="hidden"
          >
            {/* Hide the sidebar during the empty-state journey except
              for the facets / outro beats — those stages are
              *about* the sidebar, so we surface it then. During
              `facetsReveal` we wrap the aside in a soft blue
              animated glow so the user's eye lands on it as the
              copy points at it. */}
            {(!showEmptyState || sidebarVisibleDuringEmpty) && (
              // `height="full"` + `overflow="hidden"` on this wrapper is
              // load-bearing: without it the inner aside expands to its
              // intrinsic content height (1700px+ once every facet group
              // is rendered) and the HStack just hides the overflow at
              // the bottom — meaning ~half the facets are invisible AND
              // unscrollable on shorter viewports. Constraining the
              // wrapper here lets the inner VStack's `overflowY="auto"`
              // actually kick in.
              <Box
                flexShrink={0}
                data-tour-target="sidebar"
                height="full"
                overflow="hidden"
              >
                <FilterAside dimmed={dimChrome && !sidebarVisibleDuringEmpty} />
              </Box>
            )}
            {showEmptyState ? <EmptyResultsPane /> : <ResultsPane />}
          </HStack>
          <PageKeyboardShortcuts />
        </VStack>
      </OnboardingHost>
    </DensityProvider>
  );
};

const FilterAside: React.FC<{
  dimmed?: boolean;
}> = React.memo(({ dimmed = false }) => {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);

  return (
    <Box
      as="aside"
      role="complementary"
      aria-label="Trace filters"
      flexShrink={0}
      // `height="full"` chains the height constraint from the
      // outer tour-target wrapper through the aside into FilterSidebar's
      // inner `overflowY="auto"` VStack. Without it the aside ignored
      // the parent's height and let the VStack render at its intrinsic
      // ~1700px, which the parent then clipped — facets past the
      // viewport were invisible *and* unscrollable.
      height="full"
      width={collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED}
      transition="width 0.15s ease"
      borderRightWidth="1px"
      borderColor="border"
      overflow="hidden"
      {...(dimmed ? (DIMMED_PROPS as Record<string, unknown>) : {})}
    >
      <FilterSidebar />
    </Box>
  );
});
FilterAside.displayName = "FilterAside";

const ResultsPane: React.FC = React.memo(() => {
  const { data, totalHits } = useTraceListQuery();
  const pageTraceIds = useMemo(() => data.map((t) => t.traceId), [data]);
  const selectionMode = useSelectionStore((s) => s.mode);
  const explicitCount = useSelectionStore((s) => s.traceIds.size);
  const clearSelection = useSelectionStore((s) => s.clear);
  const {
    isDialogOpen,
    openExportDialog,
    closeExportDialog,
    isExporting,
    progress,
    startExport,
    cancelExport,
  } = useTraceListExport();

  const isSelectedExport =
    selectionMode === "all-matching" || explicitCount > 0;
  const dialogTraceCount =
    selectionMode === "all-matching"
      ? Math.min(totalHits, SELECT_ALL_MATCHING_CAP)
      : explicitCount > 0
        ? explicitCount
        : Math.min(totalHits, SELECT_ALL_MATCHING_CAP);

  return (
    <Flex
      as="main"
      role="main"
      aria-label="Trace results"
      direction="column"
      flex={1}
      minWidth={0}
      height="full"
    >
      <Toolbar onExportAll={() => openExportDialog()} />
      <BulkActionBar
        totalHits={totalHits}
        pageTraceIds={pageTraceIds}
        onExportSelected={(ids) => {
          // In all-matching mode, omit traceIds so the export reuses filters.
          openExportDialog(
            selectionMode === "all-matching" ? {} : { selectedTraceIds: ids },
          );
        }}
      />
      <Box flex={1} minHeight={0} position="relative">
        <Box height="full" overflow="auto" bg="bg.muted">
          <TraceTable />
        </Box>
        <FindBar />
        <Box
          position="absolute"
          bottom={4}
          right={4}
          width="320px"
          pointerEvents="none"
        >
          <Box pointerEvents="auto">
            <ExportProgress
              exported={progress.exported}
              total={progress.total}
              isExporting={isExporting}
              onCancel={cancelExport}
            />
          </Box>
        </Box>
      </Box>
      <ExportConfigDialog
        isOpen={isDialogOpen}
        onClose={closeExportDialog}
        onExport={(config) => {
          startExport(config);
          if (isSelectedExport) clearSelection();
        }}
        traceCount={dialogTraceCount}
        isSelectedExport={isSelectedExport}
      />
    </Flex>
  );
});
ResultsPane.displayName = "ResultsPane";
