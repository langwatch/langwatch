import {
  Box,
  Flex,
  HStack,
  useBreakpointValue,
  VStack,
} from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { OnboardingHost } from "../../onboarding";
import { SampleDataBanner } from "../../onboarding/components/SampleDataBanner";
import { useFirstTraceSpotlightTrigger } from "../../onboarding/hooks/useFirstTraceSpotlightTrigger";
import { usePreviewTracesActive } from "../../onboarding/hooks/usePreviewTracesActive";
import { SpotlightOverlay } from "../../onboarding/spotlights/SpotlightOverlay";
import { useOnboardingStore } from "../../onboarding/store/onboardingStore";
import { useDrawerStore } from "../../stores/drawerStore";
import { useFilterStore } from "../../stores/filterStore";
import {
  SELECT_ALL_MATCHING_CAP,
  useSelectionStore,
} from "../../stores/selectionStore";
import { useUIStore } from "../../stores/uiStore";
import { DensityProvider } from "../DensityProvider";
import { FilterSidebar } from "../FilterSidebar/FilterSidebar";
import { SidebarResizeHandle } from "../FilterSidebar/SidebarResizeHandle";
import { FindBar } from "../FindBar";
import { SearchBar } from "../SearchBar/SearchBar";
import { BulkActionBar } from "../Toolbar/BulkActionBar";
import { Toolbar } from "../Toolbar/Toolbar";
import { TraceV2DrawerShell } from "../TraceDrawer";
import { TraceTable } from "../TraceTable/TraceTable";
import { AuroraSvg } from "./AuroraSvg";
import { EmptyResultsPane } from "./EmptyResultsPane";
import { IntegratePane } from "./IntegratePane";
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
  const showSamplePreview = useOnboardingStore((s) => s.showSamplePreview);
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
  // Legacy empty-state journey — only fires when `tourActive` is explicitly
  // set. For no-traces users the new Phase 2 flow takes over: show
  // `IntegratePane` by default, or `ResultsPane` (with sample data) when
  // the user opts in via "See sample data".
  const showEmptyState = tourActive && !setupDismissed;
  // Dim the surrounding chrome only while the legacy journey card is active.
  const dimChrome = showEmptyState && !setupDisengaged;
  // Phase 2 routing: for no-traces users without the legacy journey running,
  // show the IntegratePane hero unless they've explicitly opted into sample
  // preview. Once real traces arrive, always show ResultsPane.
  const showIntegratePane =
    !showEmptyState && hasAnyTraces === false && !showSamplePreview;

  // First-real-trace one-shot: when `hasAnyTraces` flips false → true
  // for this project AND we haven't auto-fired the spotlight tour for
  // it yet, kick off spotlights so the user gets a contextual tour of
  // their own data the moment it arrives. Persisted per-project so a
  // refresh / second project doesn't re-trigger.
  useFirstTraceSpotlightTrigger({
    projectId: project?.id ?? null,
    hasAnyTraces,
  });

  // Project switches reset the per-project surfaces: the open drawer
  // points at a trace the new project can't load, and the active
  // filter query references facet values (evaluator ids, models,
  // metadata) that don't exist across projects — both would render as
  // confusing empty/error states if left in place. The ref skips the
  // initial mount so a plain page load never wipes a URL-restored
  // filter.
  const prevProjectIdRef = useRef<string | null>(null);
  const closeDrawerOnSwitch = useDrawerStore((s) => s.closeDrawer);
  const clearFilters = useFilterStore((s) => s.clearAll);
  useEffect(() => {
    const projectId = project?.id ?? null;
    const prev = prevProjectIdRef.current;
    prevProjectIdRef.current = projectId;
    if (prev === null || projectId === null || prev === projectId) return;
    closeDrawerOnSwitch();
    clearFilters();
  }, [project?.id, closeDrawerOnSwitch, clearFilters]);

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
          {/* Hide the SearchBar on the no-traces view — there's nothing
              to search for yet, and a search input sitting above the
              integration guide competes for attention without paying
              for itself. Re-appears the moment the IntegratePane is
              gone (real traces arrive or user opts into sample data). */}
          {!showIntegratePane && (
            <Box
              role="search"
              aria-label="Trace search"
              width="full"
              {...(dimChrome ? (DIMMED_PROPS as Record<string, unknown>) : {})}
            >
              <SearchBar />
            </Box>
          )}

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
            {/* Hide the sidebar during the integrate pane (no data →
                no facets to show) and during the legacy journey except
                for the facets/outro beats. */}
            {!showIntegratePane &&
              (!showEmptyState || sidebarVisibleDuringEmpty) && (
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
                  <FilterAside
                    dimmed={dimChrome && !sidebarVisibleDuringEmpty}
                  />
                </Box>
              )}
            {/* Cross-fade between the three main pane modes. `mode="wait"`
                lets the IntegratePane finish its exit (0.32s) before the
                ResultsPane mounts and fades in (0.36s with a short
                delay) — that one beat is enough to hide the heavy mount
                (TraceTable virtualizer, FilterSidebar facets, aurora
                SVG) behind the fade rather than letting users watch a
                janky pop-in. Without orchestration the swap was
                instant + laggy; with it the swap reads as deliberate. */}
            <AnimatePresence mode="wait" initial={false}>
              {showIntegratePane ? (
                // No-traces + no sample preview → show the integration hero.
                <PaneFader key="integrate">
                  <IntegratePane />
                </PaneFader>
              ) : showEmptyState ? (
                // Legacy journey (tourActive) — dormant for new users.
                <PaneFader key="empty">
                  <EmptyResultsPane />
                </PaneFader>
              ) : (
                // Real traces, or no-traces with sample preview active.
                <PaneFader key="results" delayIn={0.04}>
                  <ResultsPane />
                </PaneFader>
              )}
            </AnimatePresence>
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
 * Cross-fade wrapper for the three main pane modes (IntegratePane /
 * EmptyResultsPane / ResultsPane). `mode="wait"` on the parent
 * AnimatePresence + a tiny enter delay on the incoming child gives
 * the outgoing pane time to actually leave the DOM before the
 * heavy mount (table virtualizer, aurora SVG, facet sidebar) starts
 * — the user reads the swap as deliberate motion rather than a
 * dropped frame.
 */
const PaneFader: React.FC<{
  children: React.ReactNode;
  delayIn?: number;
}> = ({ children, delayIn = 0 }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{
      opacity: 1,
      transition: { duration: 0.36, delay: delayIn, ease: "easeOut" },
    }}
    exit={{ opacity: 0, transition: { duration: 0.24, ease: "easeIn" } }}
    style={{ display: "flex", flex: 1, minWidth: 0, height: "100%" }}
  >
    {children}
  </motion.div>
);

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
  const isSamplePreview = usePreviewTracesActive();
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
  // When the operator collapses the sidebar we drop the aside from the
  // DOM entirely — no narrow rail, no icon strip. The "expand" affordance
  // lives in the table footer (see `Pagination`) so the page is one
  // continuous slab while collapsed, with one button to bring it back.
  if (collapsed) return null;

  // No real traces yet — the discover endpoint won't return any field
  // descriptors, so the filter facets have nothing to show. Hide the
  // sidebar entirely until real data arrives so we don't present an
  // empty chrome rail with "Getting filters ready…" that never
  // populates. Exception: if the user is in sample-preview mode,
  // `useTraceFacets` swaps the empty discover response for a
  // hardcoded set derived from the sample fixtures, so the sidebar
  // has real facets to show even with `hasAnyTraces === false`.
  if (hasAnyTraces === false && !isSamplePreview) return null;

  // User-set width wins when present, else the fixed default.
  const expandedWidth = persistedWidth
    ? Math.max(persistedWidth, SIDEBAR_WIDTH_EXPANDED)
    : SIDEBAR_WIDTH_EXPANDED;

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
  // Show the sample data banner whenever preview is active — this pane
  // only renders when the user has real traces OR has explicitly opted into
  // sample preview (see IntegratePane / TracesPage routing), so always showing
  // the banner here is safe and honest.
  const showSampleBanner = isPreviewActive;
  // Aurora ribbon is a *one-shot* arrival moment. Two ways to arm it,
  // both purely mount-scoped (no persistence — if you're not on the
  // page when it happens, it's gone):
  //
  //   1. Sample-preview just flipped on for a no-traces project —
  //      the user opted into "show me what this looks like" and the
  //      ribbon punctuates that opt-in.
  //   2. While the page is mounted, `hasAnyTraces` transitions from
  //      false to true — the project's first real trace just landed,
  //      and the aurora bridges the IntegratePane → ResultsPane swap
  //      with a wash that announces "your data is here". Tracked via
  //      a simple ref of the previous value, so refreshes and tab
  //      switches naturally skip the replay (the user wasn't watching
  //      anyway), and we don't need a persisted flag.
  //
  // Either trigger arms the aurora for ~3.6s — long enough for one
  // full curtain cycle — then closes even if the underlying condition
  // is still true. Sample preview re-arms on every toggle.
  const auroraArmedSample = isPreviewActive && hasAnyTraces === false;
  const prevHasAnyTracesRef = useRef<boolean | undefined>(undefined);
  const [auroraArmedFirstReal, setAuroraArmedFirstReal] = useState(false);
  useEffect(() => {
    const prev = prevHasAnyTracesRef.current;
    prevHasAnyTracesRef.current = hasAnyTraces;
    if (prev === false && hasAnyTraces === true) {
      setAuroraArmedFirstReal(true);
    }
  }, [hasAnyTraces]);
  const [showAurora, setShowAurora] = useState(false);
  useEffect(() => {
    if (!auroraArmedSample && !auroraArmedFirstReal) {
      setShowAurora(false);
      return;
    }
    setShowAurora(true);
    const t = setTimeout(() => {
      setShowAurora(false);
      setAuroraArmedFirstReal(false);
    }, 3600);
    return () => clearTimeout(t);
  }, [auroraArmedSample, auroraArmedFirstReal]);

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
          <TraceTable />
        </Box>
        {/* Aurora ribbon — plays once when the user enters sample-preview
            mode for a no-traces project. The aurora reads as "sample traces
            are arriving" — the same marquee moment as the legacy journey, now
            triggered by the toolbar "See sample data" toggle instead of an
            auto-play state machine. */}
        {showAurora && <AuroraOverlay />}
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

/**
 * Aurora ribbon rendered as an absolute overlay inside the results pane's
 * `position: relative` Box. Plays once (fade-in, held, fade-out) when the
 * user first flips to sample preview for a no-traces project — the same
 * marquee moment as the legacy journey, now triggered by the toolbar toggle.
 *
 * The aurora intentionally has pointer-events:none and a high-but-not-
 * overlay zIndex so table rows remain clickable behind it.
 */
const AuroraOverlay: React.FC = () => (
  <AnimatePresence>
    <motion.div
      key="aurora-sample-preview"
      aria-hidden="true"
      initial={{ opacity: 0 }}
      // Cap the peak opacity well below 1 — the SVG inside has its own
      // per-curtain opacity keyframe that already peaks at 1.0, so a
      // wrapper opacity of 0.45 lands the visible intensity in
      // "ribbon, not headlight" territory. Earlier full-opacity reads
      // as someone shouting; the marquee moment should announce, not
      // shout. Fade-out runs longer than fade-in so the dismissal
      // feels more like the wash receding than a hard cut.
      animate={{ opacity: 0.45 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
      style={{
        position: "absolute",
        top: "-90px",
        left: 0,
        right: 0,
        height: 200,
        pointerEvents: "none",
        zIndex: 2,
        overflow: "hidden",
        maskImage:
          "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,0.7) 65%, transparent 100%), linear-gradient(to right, transparent 0%, rgba(0,0,0,1) 14%, rgba(0,0,0,1) 86%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,0.7) 65%, transparent 100%), linear-gradient(to right, transparent 0%, rgba(0,0,0,1) 14%, rgba(0,0,0,1) 86%, transparent 100%)",
        maskComposite: "intersect",
        WebkitMaskComposite: "source-in",
      }}
    >
      <AuroraSvg idSuffix="samplePreview" />
    </motion.div>
  </AnimatePresence>
);
