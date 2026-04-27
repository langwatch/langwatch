import { Box, Flex, HStack, VStack } from "@chakra-ui/react";
import type React from "react";
import { useEffect } from "react";
import { DensityProvider } from "../DensityProvider";
import { FilterSidebar } from "../FilterSidebar/FilterSidebar";
import { FindBar } from "../FindBar";
import { SearchBar } from "../SearchBar/SearchBar";
import { Toolbar } from "../Toolbar/Toolbar";
import { TraceTable } from "../TraceTable/TraceTable";
import { useTraceFreshness } from "../../hooks/useTraceFreshness";
import { useRollingTimeRange } from "../../hooks/useRollingTimeRange";
import { useURLSync } from "../../hooks/useURLSync";
import { useWelcomeSeen } from "../../hooks/useWelcomeSeen";
import { useUIStore } from "../../stores/uiStore";
import { useFilterStore } from "../../stores/filterStore";
import { useFindStore } from "../../stores/findStore";
import { useWelcomeStore } from "../../stores/welcomeStore";

const DEBOUNCE_MS = 300;

/**
 * Bridges SSE trace events into TanStack Query cache invalidation
 * and drives adaptive polling for useTraceNewCount.
 */
const FreshnessManager: React.FC = () => {
  useTraceFreshness();
  return null;
};

/**
 * Syncs the visual filter state (queryText, timeRange) to the
 * debounced state used for network requests.
 */
const FilterDebouncer: React.FC = () => {
  const queryText = useFilterStore((s) => s.queryText);
  const timeRange = useFilterStore((s) => s.timeRange);
  const commitDebounced = useFilterStore((s) => s.commitDebounced);

  useEffect(() => {
    const timer = setTimeout(() => {
      commitDebounced();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [queryText, timeRange, commitDebounced]);

  return null;
};

export const TracesPage: React.FC = () => {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const findIsOpen = useFindStore((s) => s.isOpen);
  const openFind = useFindStore((s) => s.open);
  const closeFind = useFindStore((s) => s.close);

  useURLSync();
  useRollingTimeRange();

  // Auto-open the welcome screen on the first visit to traces v2.
  // Lives here (not in WelcomeScreen) because WelcomeScreen mounts in
  // DashboardLayout and shouldn't auto-open on other pages.
  const welcomeIsOpen = useWelcomeStore((s) => s.isOpen);
  const openWelcome = useWelcomeStore((s) => s.open);
  const { seen: welcomeSeen, hydrated: welcomeHydrated } = useWelcomeSeen();
  useEffect(() => {
    if (welcomeHydrated && !welcomeSeen && !welcomeIsOpen) openWelcome();
  }, [welcomeHydrated, welcomeSeen, welcomeIsOpen, openWelcome]);

  // Global keyboard shortcut: [ to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (e.key === "[" && !isInputFocused) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  // Cmd/Ctrl+F: 1st press opens in-page find over loaded trace data;
  // 2nd press (while open) closes our overlay and lets the browser's
  // native find take over — no preventDefault on the second press.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.key !== "f" || e.shiftKey || e.altKey) return;

      if (findIsOpen) {
        closeFind();
        return;
      }

      e.preventDefault();
      openFind();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [findIsOpen, openFind, closeFind]);

  return (
    <DensityProvider>
      <FreshnessManager />
      <FilterDebouncer />
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
        {/* Full-width search bar at top */}
        <Box role="search" aria-label="Trace search" width="full">
          <SearchBar />
        </Box>

        {/* Sidebar + content below */}
        <HStack
          flex={1}
          align="stretch"
          width="full"
          gap={0}
          overflow="hidden"
        >
          <Box
            as="aside"
            role="complementary"
            aria-label="Trace filters"
            flexShrink={0}
            width={sidebarCollapsed ? "40px" : "220px"}
            transition="width 0.15s ease"
            borderRightWidth="1px"
            borderColor="border"
            overflow="hidden"
          >
            <FilterSidebar />
          </Box>

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
        </HStack>
      </VStack>
    </DensityProvider>
  );
};
