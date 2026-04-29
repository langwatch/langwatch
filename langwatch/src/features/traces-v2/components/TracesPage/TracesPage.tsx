import { Box, Flex, HStack, VStack } from "@chakra-ui/react";
import type React from "react";
import { useMemo } from "react";
import { useTracesV2Presence } from "~/features/presence/hooks/useTracesV2Presence";
import { useRouter } from "~/utils/compat/next-router";
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
import { useUIStore } from "../../stores/uiStore";
import { DensityProvider } from "../DensityProvider";
import { EmptyState } from "../EmptyState";
import { FilterSidebar } from "../FilterSidebar/FilterSidebar";
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
  useAutoOpenWelcome();
  useSidebarShortcut();
  useFindShortcut();
  useShortcutsHelpShortcut();
  useDensityToggleShortcut();
  useClearSelectionShortcut();
  useResetSelectionOnViewChange();
  useTracesPageTitle();

  const router = useRouter();
  const previewParam = "empty" in router.query;
  const { hasAnyTraces } = useProjectHasTraces();
  // Show the onboarding empty state when:
  //   1. The user explicitly previewed it via `?empty` (designer flow), or
  //   2. The project has truly never received a trace.
  // We deliberately don't trigger on a filter returning zero results —
  // that's a "no matches" state for the populated view to handle, not an
  // onboarding moment. `hasAnyTraces === false` is the only "true zero"
  // signal; while it's `undefined` (still loading) we keep showing the
  // table so we don't flash empty-state on every page load.
  const showEmptyState = previewParam || hasAnyTraces === false;

  return (
    <DensityProvider>
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
          {...(showEmptyState ? (DIMMED_PROPS as Record<string, unknown>) : {})}
        >
          <SearchBar />
        </Box>

        <HStack flex={1} align="stretch" width="full" gap={0} overflow="hidden">
          <FilterAside dimmed={showEmptyState} />
          {showEmptyState ? <EmptyResultsPane /> : <ResultsPane />}
        </HStack>
        <PageKeyboardShortcuts />
      </VStack>
    </DensityProvider>
  );
};

const FilterAside: React.FC<{ dimmed?: boolean }> = ({ dimmed = false }) => {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);

  return (
    <Box
      as="aside"
      role="complementary"
      aria-label="Trace filters"
      flexShrink={0}
      width={
        sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED
      }
      transition="width 0.15s ease"
      borderRightWidth="1px"
      borderColor="border"
      overflow="hidden"
      {...(dimmed ? (DIMMED_PROPS as Record<string, unknown>) : {})}
    >
      <FilterSidebar />
    </Box>
  );
};

const ResultsPane: React.FC = () => {
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
};

const EmptyResultsPane: React.FC = () => (
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
    <Box width="full" {...(DIMMED_PROPS as Record<string, unknown>)}>
      <Toolbar />
    </Box>
    <Box flex={1} minHeight={0} overflow="auto" bg="bg.panel">
      <EmptyState />
    </Box>
  </Flex>
);
