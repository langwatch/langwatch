/**
 * Suite sidebar with search, all runs link, suite list,
 * and external sets section.
 *
 * Single render path — isCollapsed controls width and label visibility,
 * so the DOM structure is stable and the toggle button never jumps.
 */

import {
  Box,
  Center,
  HStack,
  IconButton,
  Skeleton,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { SimulationSuite } from "@prisma/client";
import {
  List,
  MoreVertical,
  PanelLeftOpen,
  PanelRightOpen,
  Play,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import {
  getPassRateGradientColor,
  PassRateCircle,
} from "~/components/shared/PassRateIndicator";
import { useNow } from "~/hooks/useNow";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import type { SuiteRunSummary } from "~/server/scenarios/scenario-event.types";
import type { ExternalSetSummary } from "~/server/scenarios/scenario-event.types";
import {
  ALL_RUNS_ID,
  toExternalSetSelection,
} from "./useSuiteRouting";
import { SearchInput } from "../ui/SearchInput";

export const SUITE_SIDEBAR_COLLAPSED_KEY = "suite-sidebar-collapsed" as const;

import { ShadowDivider } from "~/components/ui/ShadowDivider";


type SuiteSidebarProps = {
  projectSlug: string;
  suites: SimulationSuite[];
  selectedSuiteSlug: string | typeof ALL_RUNS_ID | null;
  runSummaries?: Map<string, SuiteRunSummary>;
  externalSets?: ExternalSetSummary[];
  onSelectSuite: (slug: string | typeof ALL_RUNS_ID) => void;
  onRunSuite: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, suiteId: string) => void;
  isLoading?: boolean;
};

const SKELETON_COUNT = 6;

export function SuiteSidebar({
  projectSlug,
  suites,
  selectedSuiteSlug,
  runSummaries,
  externalSets = [],
  onSelectSuite,
  onRunSuite,
  onContextMenu,
  isLoading = false,
}: SuiteSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SUITE_SIDEBAR_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    try {
      localStorage.setItem(SUITE_SIDEBAR_COLLAPSED_KEY, String(next));
    } catch {
      // localStorage unavailable
    }
  };

  const filteredSuites = useMemo(() => {
    if (!searchQuery.trim()) return suites;
    const query = searchQuery.toLowerCase();
    return suites.filter((s) => s.name.toLowerCase().includes(query));
  }, [suites, searchQuery]);

  const filteredExternalSets = useMemo(() => {
    const filtered = searchQuery.trim()
      ? externalSets.filter((s) =>
          s.scenarioSetId.toLowerCase().includes(searchQuery.toLowerCase()),
        )
      : externalSets;
    return [...filtered].sort(
      (a, b) => b.lastRunTimestamp - a.lastRunTimestamp,
    );
  }, [externalSets, searchQuery]);

  const hasNoResults =
    filteredSuites.length === 0 && filteredExternalSets.length === 0;

  return (
    <VStack
      width={isCollapsed ? "auto" : "280px"}
      minWidth={isCollapsed ? "auto" : "280px"}
      height="100%"
      align="stretch"
      gap={0}
    >
      {/* Search — hidden when collapsed */}
      {!isCollapsed && (
        <Box paddingX={3} paddingBottom={2}>
          <SearchInput
            size="sm"
            borderRadius="full"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </Box>
      )}

      {/* All Runs button */}
      <Box paddingX={isCollapsed ? 6 : 2} paddingBottom={2}>
        {isCollapsed ? (
          <Tooltip content="All Runs" positioning={{ placement: "right" }}>
            <IconButton
              aria-label="All Runs"
              size="sm"
              width="full"
              variant={selectedSuiteSlug === ALL_RUNS_ID ? "solid" : "ghost"}
              onClick={() => onSelectSuite(ALL_RUNS_ID)}
            >
              <List size={16} />
            </IconButton>
          </Tooltip>
        ) : (
          <SidebarButton
            icon={<List size={14} />}
            label="All Runs"
            href={`/${projectSlug}/simulations`}
            isSelected={selectedSuiteSlug === ALL_RUNS_ID}
            onClick={() => onSelectSuite(ALL_RUNS_ID)}
          />
        )}
      </Box>

      <ShadowDivider />

      {/* Suite list */}
      <VStack
        flex={1}
        overflow="auto"
        paddingX={isCollapsed ? 6 : 2}
        paddingTop={2}
        paddingBottom={2}
        gap={isCollapsed ? 0 : 1}
        align="stretch"
      >
        {isLoading && !isCollapsed && (
          Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <Skeleton
              key={i}
              data-testid="suite-sidebar-skeleton"
              height="60px"
              width="100%"
              borderRadius="md"
              marginBottom={1}
            />
          ))
        )}

        {!isLoading && !isCollapsed && hasNoResults && suites.length === 0 && externalSets.length === 0 && (
          <Text
            fontSize="sm"
            color="fg.muted"
            paddingX={2}
            paddingY={4}
            textAlign="center"
          >
            No run plans yet
          </Text>
        )}
        {!isLoading && !isCollapsed && hasNoResults &&
          (suites.length > 0 || externalSets.length > 0) && (
            <Text
              fontSize="sm"
              color="fg.muted"
              paddingX={2}
              paddingY={4}
              textAlign="center"
            >
              No matching run plans
            </Text>
          )}

        {!isLoading && filteredSuites.map((suite) =>
          isCollapsed ? (
            <Tooltip
              key={suite.id}
              content={suite.name}
              positioning={{ placement: "right" }}
            >
              <IconButton
                aria-label={suite.name}
                size="sm"
                width="full"
                variant={suite.slug === selectedSuiteSlug ? "solid" : "ghost"}
                onClick={() => onSelectSuite(suite.slug)}
              >
                <Center
                  width="22px"
                  height="22px"
                  borderRadius="full"
                  bg={suite.slug === selectedSuiteSlug ? "transparent" : "bg.emphasized"}
                  fontSize="xs"
                  fontWeight="bold"
                >
                  {suite.name.charAt(0).toUpperCase()}
                </Center>
              </IconButton>
            </Tooltip>
          ) : (
            <SuiteListItem
              key={suite.id}
              suite={suite}
              projectSlug={projectSlug}
              isSelected={suite.slug === selectedSuiteSlug}
              runSummary={runSummaries?.get(suite.id)}
              onSelect={() => onSelectSuite(suite.slug)}
              onRun={() => onRunSuite(suite.id)}
              onContextMenu={(e) => onContextMenu(e, suite.id)}
            />
          ),
        )}

        {!isLoading && filteredExternalSets.length > 0 && (
          <>
            {!isCollapsed && (
              <Text
                data-testid="external-sets-header"
                fontSize="xs"
                fontWeight="bold"
                color="fg.muted"
                letterSpacing="wider"
                paddingX={2}
                paddingTop={3}
                paddingBottom={1}
              >
                EXTERNAL SETS
              </Text>
            )}
            {isCollapsed && <Box paddingY={0.5}><ShadowDivider /></Box>}
            {filteredExternalSets.map((extSet) =>
              isCollapsed ? (
                <Tooltip
                  key={extSet.scenarioSetId}
                  content={extSet.scenarioSetId}
                  positioning={{ placement: "right" }}
                >
                  <IconButton
                    aria-label={extSet.scenarioSetId}
                    size="sm"
                    width="full"
                    variant={
                      selectedSuiteSlug ===
                      toExternalSetSelection(extSet.scenarioSetId)
                        ? "solid"
                        : "ghost"
                    }
                    onClick={() =>
                      onSelectSuite(
                        toExternalSetSelection(extSet.scenarioSetId),
                      )
                    }
                  >
                    <Center
                      width="22px"
                      height="22px"
                      borderRadius="full"
                      bg={
                        selectedSuiteSlug === toExternalSetSelection(extSet.scenarioSetId)
                          ? "transparent"
                          : "bg.emphasized"
                      }
                      fontSize="xs"
                      fontWeight="bold"
                    >
                      {extSet.scenarioSetId.charAt(0).toUpperCase()}
                    </Center>
                  </IconButton>
                </Tooltip>
              ) : (
                <ExternalSetListItem
                  key={extSet.scenarioSetId}
                  externalSet={extSet}
                  projectSlug={projectSlug}
                  isSelected={
                    selectedSuiteSlug ===
                    toExternalSetSelection(extSet.scenarioSetId)
                  }
                  onSelect={() =>
                    onSelectSuite(
                      toExternalSetSelection(extSet.scenarioSetId),
                    )
                  }
                />
              ),
            )}
          </>
        )}
      </VStack>

      {/* Toggle button — always the same DOM node */}
      <ShadowDivider />
      <HStack paddingX={isCollapsed ? 6 : 3} paddingY={1.5} justify="flex-start">
        <IconButton
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          size="sm"
          variant="outline"
          width={isCollapsed ? "full" : undefined}
          onClick={toggleCollapsed}
        >
          {isCollapsed ? <PanelLeftOpen size={16} /> : <PanelRightOpen size={16} />}
        </IconButton>
      </HStack>
    </VStack>
  );
}

function SidebarButton({
  icon,
  label,
  href,
  isSelected = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  href?: string;
  isSelected?: boolean;
  onClick: () => void;
}) {
  const handleClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.button === 1) return;
    e.preventDefault();
    onClick();
  };

  return (
    <HStack
      asChild
      width="full"
      paddingX={2}
      paddingY={1.5}
      borderRadius="md"
      cursor="pointer"
      bg={isSelected ? "bg.emphasized" : "transparent"}
      _hover={{ bg: isSelected ? "bg.emphasized" : "bg.subtle" }}
      onClick={handleClick}
      gap={2}
      textDecoration="none"
      color="inherit"
    >
      <a href={href ?? "#"}>
        {icon}
        <Text fontSize="sm">{label}</Text>
      </a>
    </HStack>
  );
}

function RunSummaryLine({
  passedCount,
  failedCount,
  totalCount,
}: {
  passedCount: number;
  failedCount: number;
  totalCount: number;
}) {
  if (totalCount === 0) return null;

  const completedCount = passedCount + failedCount;
  const passRate = completedCount > 0 ? (passedCount / totalCount) * 100 : null;

  return (
    <HStack gap={1} color="fg.muted">
      <PassRateCircle passRate={passRate} size="8px" />
      <Text fontSize="xs" color={getPassRateGradientColor(passRate)} fontWeight="medium">
        {passRate === null ? "-" : `${Math.round(passRate)}%`}
      </Text>
      <Text fontSize="xs" color="gray.350">·</Text>
      <Text fontSize="xs" color="fg.subtle">
        {passedCount} passed
      </Text>
    </HStack>
  );
}

function SidebarListItemWrapper({
  isSelected,
  href,
  onClick,
  onContextMenu,
  className,
  "data-testid": dataTestId,
  children,
}: {
  isSelected: boolean;
  href?: string;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  className?: string;
  "data-testid"?: string;
  children: React.ReactNode;
}) {
  const handleClick = (e: React.MouseEvent) => {
    // Allow cmd+click / ctrl+click / middle-click to open in new tab naturally
    if (e.metaKey || e.ctrlKey || e.button === 1) return;
    e.preventDefault();
    onClick();
  };

  return (
    <HStack
      asChild
      className={className}
      data-testid={dataTestId}
      data-selected={isSelected || undefined}
      paddingX={3}
      position="relative"
      paddingY={3}
      borderRadius="md"
      cursor="pointer"
      bg={isSelected ? "bg.subtle" : "transparent"}
      border={isSelected ? "1px solid border.emphasized" : "none"}
      _hover={{ bg: isSelected ? "bg.emphasized" : "bg.subtle" }}
      onContextMenu={onContextMenu}
      onClick={handleClick}
      justify="space-between"
      width="full"
      textDecoration="none"
      color="inherit"
      _before={{
        content: '""',
        position: "absolute",
        transform: "translateY(-50%)",
        top: "50%",
        left: 0,
        width: "2px",
        height: "33%",
        backgroundColor: "border.emphasized",
        display: isSelected ? "block" : "none",
      }}
    >
      <a href={href ?? "#"}>
        {children}
      </a>
    </HStack>
  );
}

function SuiteListItem({
  suite,
  projectSlug,
  isSelected,
  runSummary,
  onSelect,
  onRun,
  onContextMenu,
}: {
  suite: SimulationSuite;
  projectSlug: string;
  isSelected: boolean;
  runSummary?: SuiteRunSummary;
  onSelect: () => void;
  onRun: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const now = useNow();
  return (
    <SidebarListItemWrapper
      className="group"
      data-testid="suite-list-item"
      href={`/${projectSlug}/simulations/run-plans/${suite.slug}`}
      isSelected={isSelected}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      <VStack
        align="start"
        gap={0}
        flex={1}
        overflow="hidden"
        textAlign="left"
      >
        <HStack gap={1.5} width="full">
          <Text fontSize="13px" fontWeight="medium" lineClamp={1}>
            {suite.name || "<empty>"}
          </Text>
          <Spacer />
          {runSummary?.lastRunTimestamp && (
            <Text fontSize="11px" color="fg.subtle" flexShrink={0} whiteSpace="nowrap">
              {formatTimeAgoCompact(runSummary.lastRunTimestamp, now)}
            </Text>
          )}
          <HStack gap={0} flexShrink={0}>
            <Box
              as="button"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                onRun();
              }}
              paddingX={1}
              paddingY={0.5}
              borderRadius="sm"
              _hover={{ bg: "bg.muted" }}
              cursor="pointer"
              display="flex"
              alignItems="center"
              gap={1}
              flexShrink={0}
            >
              <Play size={12} />
              <Text fontSize="xs">Run</Text>
            </Box>
            <Box
              as="button"
              aria-label="Run plan options"
              data-testid="suite-menu-button"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                onContextMenu(e);
              }}
              paddingX={1}
              paddingY={0.5}
              borderRadius="sm"
              _hover={{ bg: "bg.muted" }}
              display="flex"
              alignItems="center"
              opacity={0}
              _groupHover={{ opacity: 1 }}
              transition="opacity 150ms"
              cursor="pointer"
            >
              <MoreVertical size={14} />
            </Box>
          </HStack>
        </HStack>
        {runSummary && runSummary.totalCount > 0 && (
          <RunSummaryLine
            passedCount={runSummary.passedCount}
            failedCount={runSummary.failedCount}
            totalCount={runSummary.totalCount}
          />
        )}
      </VStack>
    </SidebarListItemWrapper>
  );
}

/** Read-only list item for external SDK/CI sets. No Run button or context menu. */
function ExternalSetListItem({
  externalSet,
  projectSlug,
  isSelected,
  onSelect,
}: {
  externalSet: ExternalSetSummary;
  projectSlug: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const now = useNow();
  return (
    <SidebarListItemWrapper
      data-testid="external-set-list-item"
      href={`/${projectSlug}/simulations/${externalSet.scenarioSetId}`}
      isSelected={isSelected}
      onClick={onSelect}
    >
      <VStack
        align="start"
        gap={0}
        flex={1}
        overflow="hidden"
        textAlign="left"
      >
        <HStack gap={1.5} width="full">
          <Text fontSize="13px" fontWeight="medium" lineClamp={1}>
            {externalSet.scenarioSetId || "<empty>"}
          </Text>
          <Spacer />
          {externalSet.lastRunTimestamp && (
            <Text fontSize="11px" color="fg.subtle" flexShrink={0} whiteSpace="nowrap">
              {formatTimeAgoCompact(externalSet.lastRunTimestamp, now)}
            </Text>
          )}
        </HStack>
        {externalSet.totalCount > 0 && (
          <RunSummaryLine
            passedCount={externalSet.passedCount}
            failedCount={externalSet.failedCount}
            totalCount={externalSet.totalCount}
          />
        )}
      </VStack>
    </SidebarListItemWrapper>
  );
}
