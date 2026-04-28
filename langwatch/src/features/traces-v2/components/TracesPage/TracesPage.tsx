import { Box, Flex, HStack, VStack } from "@chakra-ui/react";
import type React from "react";
import { useTracesV2Presence } from "~/features/presence/hooks/useTracesV2Presence";
import { useRollingTimeRange } from "../../hooks/useRollingTimeRange";
import { useTraceFreshness } from "../../hooks/useTraceFreshness";
import { useURLSync } from "../../hooks/useURLSync";
import { useUIStore } from "../../stores/uiStore";
import { DensityProvider } from "../DensityProvider";
import { FilterSidebar } from "../FilterSidebar/FilterSidebar";
import { FindBar } from "../FindBar";
import { SearchBar } from "../SearchBar/SearchBar";
import { Toolbar } from "../Toolbar/Toolbar";
import { TraceTable } from "../TraceTable/TraceTable";
import { useAutoOpenWelcome } from "./useAutoOpenWelcome";
import { useDebouncedFilterCommit } from "./useDebouncedFilterCommit";
import { useFindShortcut, useSidebarShortcut } from "./useKeyboardShortcuts";

const SIDEBAR_WIDTH_EXPANDED = "220px";
const SIDEBAR_WIDTH_COLLAPSED = "40px";

export const TracesPage: React.FC = () => {
  useURLSync();
  useRollingTimeRange();
  useTraceFreshness();
  useTracesV2Presence();
  useDebouncedFilterCommit();
  useAutoOpenWelcome();
  useSidebarShortcut();
  useFindShortcut();

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
        <Box role="search" aria-label="Trace search" width="full">
          <SearchBar />
        </Box>

        <HStack
          flex={1}
          align="stretch"
          width="full"
          gap={0}
          overflow="hidden"
        >
          <FilterAside />
          <ResultsPane />
        </HStack>
      </VStack>
    </DensityProvider>
  );
};

const FilterAside: React.FC = () => {
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
    >
      <FilterSidebar />
    </Box>
  );
};

const ResultsPane: React.FC = () => (
  <Flex
    as="main"
    role="main"
    aria-label="Trace results"
    direction="column"
    flex={1}
    minWidth={0}
    height="full"
  >
    <Toolbar />
    <Box flex={1} minHeight={0} position="relative">
      <Box height="full" overflow="auto" bg="bg.panel">
        <TraceTable />
      </Box>
      <FindBar />
    </Box>
  </Flex>
);
