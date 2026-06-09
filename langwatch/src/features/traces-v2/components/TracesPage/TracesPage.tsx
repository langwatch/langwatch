import { Box, Flex, HStack, useBreakpointValue, VStack } from "@chakra-ui/react";
import React, { useMemo } from "react";
import { ExportConfigDialog } from "~/components/messages/ExportConfigDialog";
import { ExportProgress } from "~/components/messages/ExportProgress";
import { useTracesV2Presence } from "~/features/presence/hooks/useTracesV2Presence";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useLensFilterDirtySync } from "../../hooks/useLensFilterDirtySync";
import { useLensSync } from "../../hooks/useLensSync";
import { useProjectHasTraces } from "../../hooks/useProjectHasTraces";
import { useResetSelectionOnViewChange } from "../../hooks/useResetSelectionOnViewChange";
import { useRollingTimeRange } from "../../hooks/useRollingTimeRange";
import { useTraceDrawerUrlHydrator } from "../../hooks/useTraceDrawerUrlHydrator";
import { useTraceFreshness } from "../../hooks/useTraceFreshness";
import { useTraceListExport } from "../../hooks/useTraceListExport";
import { useTraceListQuery } from "../../hooks/useTraceListQuery";
import { useURLSync } from "../../hooks/useURLSync";
import { useDrawerStore } from "../../stores/drawerStore";
import { TraceV2DrawerShell } from "../TraceDrawer";
import { OnboardingHost } from "../../onboarding";
import { SpotlightOverlay } from "../../onboarding/spotlights/SpotlightOverlay";
import { useOnboardingStore } from "../../onboarding/store/onboardingStore";
import { IntegrationCTACard } from "../../onboarding/components/IntegrationCTACard";
import { SampleDataBanner } from "../../onboarding/components/SampleDataBanner";
import { usePreviewTracesActive } from "../../onboarding/hooks/usePreviewTracesActive";
import {
  SELECT_ALL_MATCHING_CAP,
  useSelectionStore,
} from "../../stores/selectionStore";
import { useFilterStore } from "../../stores/filterStore";
import { useUIStore } from "../../stores/uiStore";
import { analyzeOrGroups } from "~/server/app-layer/traces/query-language/queries";
import { DensityProvider } from "../DensityProvider";
import { FilterSidebar } from "../FilterSidebar/FilterSidebar";
import { SidebarResizeHandle } from "../FilterSidebar/SidebarResizeHandle";
import { ConnectorLaneWidth } from "../FilterSidebar/OrConnectorOverlay";
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

const SIDEBAR_WIDTH_EXPANDED = 220;
const SIDEBAR_WIDTH_MAX = 640;
// Minimum width the operator can drag the sidebar to before we accept
// it as "intended to keep visible." Below this, an inward drag commits
// a full collapse instead of an awkward sliver. Kept low (40px) so a
// short accidental drag doesn't snap the sidebar shut — operators who
// actually want it gone have to drag clearly into the trace table.
const SIDEBAR_COLLAPSE_THRESHOLD = 40;

const DIMMED_PROPS = {
  opacity: 0.45,
  pointerEvents: "none" as const,
  "aria-disabled": true,
  // `inert` keeps focus, hover, and pointer interactions out of the chrome
  // while the empty-state body is what the user should be touching.
  // React types lag the DOM property, so we widen via a record cast at the
  // call sites that compose this object. `inert` belt-and-suspenders the
  // pointer-events block: even if a portal-rendered popover bypassed the
  // wrapper's pointer-events, the trigger's click never fires under inert.
  inert: "",
};

export const TracesPage: React.FC = () => {
  useURLSync();
  useRollingTimeRange();
  useTraceFreshness();
  useTracesV2Presence();
  useDebouncedFilterCommit();
  useLensFilterDirtySync();
  useLensSync();
  // URL → drawer store sync so a deep link / browser-back still opens
  // the drawer. The actual mount decision is in this component (see
  // `traceDrawerMounted` below), so the click → render path doesn't
  // wait for React Router to commit the URL change.
  useTraceDrawerUrlHydrator();
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
  // Empty state (old journey takeover) now only shows when `tourActive`
  // is explicitly set via the legacy journey entry point. No-traces users
  // see the regular `ResultsPane` with sample data injected via
  // `usePreviewTracesActive` and an inline integration CTA card.
  // Phase 2 will replace the journey state machine with contextual
  // spotlights and this branch will be removed entirely.
  const showEmptyState = tourActive && !setupDismissed;
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
          <TraceDrawerMount />
        </VStack>
        {/* Phase 2 spotlight tour overlay — floats above the page,
            non-modal. Activated by the "Show me around" toolbar button
            or by #sp=<id> in the URL fragment. */}
        <SpotlightOverlay />
      </OnboardingHost>
    </DensityProvider>
  );
};

/**
 * Optimistic drawer mount. Reads `traceId` straight from the drawer
 * store so a click → store-update → render lands in the same frame.
 * The URL is still kept in sync (via openDrawer / closeDrawer in the
 * scaffold), it just no longer gates the mount the way
 * `CurrentDrawer` used to.
 */
const TraceDrawerMount: React.FC = () => {
  const hasTrace = useDrawerStore((s) => !!s.traceId);
  if (!hasTrace) return null;
  return <TraceV2DrawerShell />;
};

const FilterAside: React.FC<{
  dimmed?: boolean;
}> = React.memo(({ dimmed = false }) => {
  const persistedCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const persistedWidth = useUIStore((s) => s.sidebarWidth);
  const mobileExpandedOverride = useUIStore((s) => s.mobileExpandedOverride);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const persistSidebarLayout = useUIStore((s) => s.persistSidebarLayout);
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const { hasAnyTraces } = useProjectHasTraces();
  // Below `md` the expanded sidebar steals 240px+ from a 390px-wide
  // viewport, leaving the actual trace table unreadable. Force the
  // collapsed rail on small screens regardless of the persisted preference,
  // BUT honour the transient `mobileExpandedOverride` so the explicit
  // expand button and the keyboard shortcut still work — they flip the
  // override instead of the persisted desktop pref.
  const forceCollapsedSmallScreen = useBreakpointValue(
    { base: true, md: false },
    { fallback: "md" },
  );
  const collapsed = forceCollapsedSmallScreen
    ? !mobileExpandedOverride
    : persistedCollapsed;
  // Grow the aside by one lane per active OR group so the connector
  // overlay has room to draw without squeezing the facet rows. When
  // the AST has no cross-facet OR the width is identical to before.
  const orGroupCount = useFilterStore(
    (s) => analyzeOrGroups(s.ast).groups.length,
  );

  // When the operator collapses the sidebar we drop the aside from the
  // DOM entirely — no narrow rail, no icon strip. The "expand" affordance
  // lives in the table footer (see `Pagination`) so the page is one
  // continuous slab while collapsed, with one button to bring it back.
  if (collapsed) return null;

  // No real traces yet — the discover endpoint won't return any field
  // descriptors, so the filter facets have nothing to show. Hide the
  // sidebar entirely until real data arrives so we don't present an
  // empty chrome rail with "Getting filters ready…" that never populates.
  // `FilterSidebar` also checks this independently but we gate here too
  // so the outer `Box` wrapper (which has explicit `width`) isn't left
  // as a silent whitespace column.
  if (hasAnyTraces === false) return null;

  const autoExpandedWidth =
    SIDEBAR_WIDTH_EXPANDED + orGroupCount * ConnectorLaneWidth;
  // User-set width wins when present, else the auto-computed default.
  // The dragged width still respects the auto default as a floor — adding
  // an OR group should never visually shrink the sidebar below the lane
  // count the connector overlay needs to draw without squeezing rows.
  const expandedWidth = persistedWidth
    ? Math.max(persistedWidth, autoExpandedWidth)
    : autoExpandedWidth;

  // Don't show the resize handle on mobile (forced-collapsed) or while
  // the empty-state dim is active — neither surface supports a drag-out.
  const showResizeHandle = !forceCollapsedSmallScreen && !dimmed;

  return (
    <Box
      as="aside"
      role="complementary"
      aria-label="Trace filters"
      position="relative"
      flexShrink={0}
      // `height="full"` chains the height constraint from the
      // outer tour-target wrapper through the aside into FilterSidebar's
      // inner `overflowY="auto"` VStack. Without it the aside ignored
      // the parent's height and let the VStack render at its intrinsic
      // ~1700px, which the parent then clipped — facets past the
      // viewport were invisible *and* unscrollable.
      height="full"
      width={`${expandedWidth}px`}
      transition="width 0.15s ease"
      overflow="hidden"
      {...(dimmed ? (DIMMED_PROPS as Record<string, unknown>) : {})}
    >
      <FilterSidebar />
      {showResizeHandle && (
        <SidebarResizeHandle
          currentWidth={expandedWidth}
          collapseBelow={SIDEBAR_COLLAPSE_THRESHOLD}
          max={SIDEBAR_WIDTH_MAX}
          onResize={setSidebarWidth}
          onResizeEnd={persistSidebarLayout}
          onCollapse={() => setSidebarCollapsed(true)}
        />
      )}
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

  const { hasAnyTraces } = useProjectHasTraces();
  const isPreviewActive = usePreviewTracesActive();
  const showSamplePreview = useOnboardingStore((s) => s.showSamplePreview);
  // Only show the "this is sample data" banner when the user has real traces
  // and explicitly opted in via the toolbar. For no-traces projects the CTA
  // card already explains that the rows are sample data, so the banner would
  // be redundant.
  const showSampleBanner = isPreviewActive && hasAnyTraces === true && showSamplePreview;

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
      {/* Sample-data ribbon — shown when user has real traces and has
          explicitly opted into sample preview. Not shown for no-traces
          projects where the CTA card already contextualises the sample rows. */}
      {showSampleBanner && <SampleDataBanner />}
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
        {/*
          Light mode: the table sits on a pure-white surface so the eye
          anchors on the gray sticky header row above it (DevTools
          "Network" inversion). Dark mode keeps the legacy muted dark
          background that operators already approved.
        */}
        <Box
          height="full"
          overflow="auto"
          bg={{ base: "bg.surface", _dark: "bg.muted" }}
        >
          {/* Integration CTA card — pinned banner above the trace rows for
              no-traces projects. Self-gates via useIntegrationCTAVisible so
              it vanishes once real traces arrive or the user snoozes it. */}
          <IntegrationCTACard />
          <TraceTable />
        </Box>
        <FindBar />
        <Box
          position="absolute"
          bottom={4}
          right={4}
          width="320px"
          pointerEvents="none"
          // Sit above the table's row hover overlays (IOPreview, etc.) so the
          // progress toast doesn't get painted under in-row text while a long
          // export is running.
          zIndex="overlay"
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
