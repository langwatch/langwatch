import { Box, Flex, HStack, VStack } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import React, { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTracesV2Presence } from "~/features/presence/hooks/useTracesV2Presence";
import { ExportConfigDialog } from "~/components/messages/ExportConfigDialog";
import { ExportProgress } from "~/components/messages/ExportProgress";
import { useProjectHasTraces } from "../../hooks/useProjectHasTraces";
import { useLensFilterDirtySync } from "../../hooks/useLensFilterDirtySync";
import { useResetSelectionOnViewChange } from "../../hooks/useResetSelectionOnViewChange";
import { useRollingTimeRange } from "../../hooks/useRollingTimeRange";
import { useTraceFreshness } from "../../hooks/useTraceFreshness";
import { useTraceListExport } from "../../hooks/useTraceListExport";
import { useTraceListQuery } from "../../hooks/useTraceListQuery";
import { useURLSync } from "../../hooks/useURLSync";
import {
  SELECT_ALL_MATCHING_CAP,
  useSelectionStore,
} from "../../stores/selectionStore";
import { useOnboardingStore } from "../../onboarding/store/onboardingStore";
import { shouldShowAurora } from "../../onboarding/chapters/onboardingJourneyConfig";
import { RICH_ARRIVAL_TRACE_ID } from "../../onboarding/data/samplePreviewTraces";
import { useUIStore } from "../../stores/uiStore";
import { DensityProvider } from "../DensityProvider";
import { OnboardingHost } from "../../onboarding";
import { EmptyStateOverlay } from "../../onboarding/components/EmptyStateOverlay";
import { SampleDataBanner } from "../../onboarding/components/SampleDataBanner";
import { FilterSidebar } from "../FilterSidebar/FilterSidebar";
import { AuroraSvg } from "./AuroraSvg";
import { FindBar } from "../FindBar";
import { SearchBar } from "../SearchBar/SearchBar";
import { BulkActionBar } from "../Toolbar/BulkActionBar";
import { Toolbar } from "../Toolbar/Toolbar";
import { TraceTable } from "../TraceTable/TraceTable";
import { PageKeyboardShortcuts } from "./PageKeyboardShortcuts";
import { useAutoOpenWelcome } from "./useAutoOpenWelcome";
import { useDebouncedFilterCommit } from "./useDebouncedFilterCommit";
import { useTracesPageTitle } from "./usePageTitle";
import {
  useClearSelectionShortcut,
  useDensityToggleShortcut,
  useFindShortcut,
  useShortcutsHelpShortcut,
  useSidebarShortcut,
} from "./useKeyboardShortcuts";

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
  const setupDismissed = project ? !!setupDismissedByProject[project.id] : false;
  // Read the onboarding stage at the top level so we can decide
  // whether to surface the FilterSidebar even while the empty
  // state is technically "active" — the `facetsReveal` and `outro`
  // stages are *meant* to show the sidebar.
  const topLevelOnboardingStage = useOnboardingStore((s) => s.stage);
  const sidebarVisibleDuringEmpty =
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
  // The empty-state journey is its own onboarding tour, so the
  // What's-new dialog must not auto-open on top of it. New users
  // get one tour at a time; once they've sent a real trace and the
  // empty state retires, the What's-new auto-open returns to its
  // normal first-visit behaviour.
  useAutoOpenWelcome({ enabled: !showEmptyState });
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

        <HStack flex={1} align="stretch" width="full" gap={0} overflow="hidden">
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
              <FilterAside
                dimmed={dimChrome && !sidebarVisibleDuringEmpty}
              />
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

const EmptyResultsPane: React.FC = React.memo(() => {
  // The trace list query short-circuits to `SAMPLE_PREVIEW_TRACES`
  // (purely client-side) whenever this pane is rendered, so the table
  // behind is always populated with interactive rows. The dim lifts
  // the moment the user commits to an exit action (`setupDisengaged`)
  // — sample data is already on screen, no waiting for ingestion.
  const setupDisengaged = useOnboardingStore((s) => s.setupDisengaged);
  const onboardingStage = useOnboardingStore((s) => s.stage);
  const showAuroraStrip = shouldShowAurora(onboardingStage);
  const isPostArrival = onboardingStage === "postArrival";

  return (
    <Flex
      as="main"
      role="main"
      aria-label="Set up tracing"
      direction="column"
      flex={1}
      minWidth={0}
      height="full"
      overflow="hidden"
    >
      <Box
        width="full"
        {...(setupDisengaged
          ? {}
          : (DIMMED_PROPS as Record<string, unknown>))}
      >
        <Toolbar />
      </Box>
      {/* Sample-data banner — sits between toolbar and table so users
          can read it before they touch a facet. Always-on while preview
          is active; the only way out is its "Done exploring" button,
          which flips the dismissal flag and drops the user into the
          real (empty) table. */}
      <SampleDataBanner />
      <Box flex={1} minHeight={0} position="relative" overflow="hidden">
        <Box
          position="absolute"
          inset={0}
          overflow="auto"
          bg="bg.muted"
          // Pre-disengaged: full opacity. Pointer events are suppressed
          // so the table behind the empty-state hero isn't accidentally
          // clickable through the overlay. The "rows-above-and-below"
          // band effect is *not* a mask on the table any more — it's a
          // hero-attached radial halo (see `EmptyState.tsx`) that auto-
          // aligns with the flex-centred hero. That keeps the layout
          // robust across viewport heights without fragile percentage
          // bands or media-query tuning.
          {...(setupDisengaged || isPostArrival
            ? // Fully clickable during postArrival — the table takes
              // the whole canvas and the user gets to explore. Any
              // sample row opens the drawer (and advances the journey
              // to tourGate via the same path); the highlighted rich
              // row is just the visually obvious target, not the only
              // one. setupDisengaged is the post-onboarding state
              // where preview data is still rendering.
              {}
            : ({
                pointerEvents: "none",
                "aria-disabled": true,
                inert: "",
              } as Record<string, unknown>))}
          // During `postArrival` the rich arrival row gets the same
          // visual language as the drawer-tour glow: a soft blue
          // halo that pulses around the *whole row*, not per-cell.
          // Implemented with `filter: drop-shadow(...)` on the
          // tbody — drop-shadow paints from the rendered cell area
          // outward, so it traces the row's outer edge as one
          // continuous shape even though `border-collapse: collapse`
          // means tbody/tr can't carry box-shadow themselves.
          // Per-cell inset box-shadow + a faint background-tint
          // give the inner ring; the row itself is `z-index: 10` so
          // the halo doesn't get clipped by neighbouring rows.
          css={
            isPostArrival
              ? {
                  // Light theme: heavier alpha needed for blue to
                  // read against a white surface without disappearing.
                  "@keyframes tracesV2RichRowGlow": {
                    "0%, 100%": {
                      filter:
                        "drop-shadow(0 0 6px rgba(59, 130, 246, 0.45)) drop-shadow(0 0 16px rgba(99, 102, 241, 0.24))",
                    },
                    "50%": {
                      filter:
                        "drop-shadow(0 0 12px rgba(59, 130, 246, 0.7)) drop-shadow(0 0 26px rgba(99, 102, 241, 0.36))",
                    },
                  },
                  // Dark theme: sky-blue palette (blue.300-ish) so the
                  // glow stays visible without going neon. Lower
                  // base alpha, similar peak — same shape, tuned
                  // for the darker canvas.
                  "@keyframes tracesV2RichRowGlowDark": {
                    "0%, 100%": {
                      filter:
                        "drop-shadow(0 0 8px rgba(125, 211, 252, 0.32)) drop-shadow(0 0 20px rgba(165, 180, 252, 0.2))",
                    },
                    "50%": {
                      filter:
                        "drop-shadow(0 0 14px rgba(125, 211, 252, 0.55)) drop-shadow(0 0 30px rgba(165, 180, 252, 0.34))",
                    },
                  },
                  [`& tbody[data-trace-id="${RICH_ARRIVAL_TRACE_ID}"]`]: {
                    position: "relative",
                    zIndex: 10,
                    cursor: "pointer",
                    animation:
                      "tracesV2RichRowGlow 2.2s ease-in-out infinite",
                    transition: "filter 220ms ease",
                    _dark: {
                      animation:
                        "tracesV2RichRowGlowDark 2.2s ease-in-out infinite",
                    },
                  },
                  // Inner blue ring — inset shadow on every cell,
                  // gives the row a clear outline that joins up
                  // along shared edges (collapsed borders share
                  // pixels so adjacent insets line up). Background
                  // tint is the same uniform alpha across the row.
                  [`& tbody[data-trace-id="${RICH_ARRIVAL_TRACE_ID}"] td`]:
                    {
                      backgroundColor: "rgba(59, 130, 246, 0.08)",
                      boxShadow: "inset 0 0 0 1px rgba(59, 130, 246, 0.45)",
                      transition:
                        "background-color 200ms ease, box-shadow 200ms ease",
                      _dark: {
                        backgroundColor: "rgba(125, 211, 252, 0.1)",
                        boxShadow:
                          "inset 0 0 0 1px rgba(125, 211, 252, 0.32)",
                      },
                    },
                  [`& tbody[data-trace-id="${RICH_ARRIVAL_TRACE_ID}"]:hover td`]:
                    {
                      backgroundColor: "rgba(59, 130, 246, 0.18)",
                      boxShadow: "inset 0 0 0 1px rgba(59, 130, 246, 0.7)",
                      _dark: {
                        backgroundColor: "rgba(125, 211, 252, 0.2)",
                        boxShadow:
                          "inset 0 0 0 1px rgba(125, 211, 252, 0.55)",
                      },
                    },
                }
              : undefined
          }
        >
          <TraceTable />
        </Box>
        {/* Aurora strip — exact same pattern as `RefreshProgressBar`
            so the visual word (a refresh / arrival / new-span swell)
            stays consistent everywhere on the platform. The only
            tweak is an extra horizontal mask so the ribbon fades
            into the page edges. Normally `FilterSidebar` covers the
            leftmost slice and gives a natural visual gutter; during
            onboarding the sidebar is hidden, so without the
            horizontal fade the aurora would butt right up against
            the viewport edge and read as a banner. */}
        <AnimatePresence>
          {showAuroraStrip && (
            <motion.div
              key="onboarding-aurora"
              aria-hidden="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
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
              <AuroraSvg idSuffix="onboardingArrival" />
            </motion.div>
          )}
        </AnimatePresence>
        <Box position="absolute" inset={0} overflow="auto" zIndex={1}>
          <EmptyStateOverlay />
        </Box>
      </Box>
    </Flex>
  );
});
EmptyResultsPane.displayName = "EmptyResultsPane";
