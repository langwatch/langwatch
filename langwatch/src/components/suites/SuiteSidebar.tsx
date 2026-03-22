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
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import type { SuiteRunSummary } from "./run-history-transforms";
import type { ExternalSetSummary } from "~/server/scenarios/scenario-event.types";
import {
  ALL_RUNS_ID,
  toExternalSetSelection,
} from "./useSuiteRouting";
import { SearchInput } from "../ui/SearchInput";

export const SUITE_SIDEBAR_COLLAPSED_KEY = "suite-sidebar-collapsed" as const;

/** 1px border line + soft downward shadow, matching the prompt playground divider. */
function ShadowDivider() {
  return (
    <Box width="full" flexShrink={0} position="relative">
      <Box
        width="full"
        height="1px"
        bg="border.muted"
      />
      <Box
        width="full"
        height="4px"
        background="linear-gradient(to bottom, var(--chakra-colors-border-muted), transparent)"
        opacity={0.4}
      />
    </Box>
  );
}


type SuiteSidebarProps = {
  suites: SimulationSuite[];
  selectedSuiteSlug: string | typeof ALL_RUNS_ID | null;
  runSummaries?: Map<string, SuiteRunSummary>;
  externalSets?: ExternalSetSummary[];
  onSelectSuite: (slug: string | typeof ALL_RUNS_ID) => void;
  onRunSuite: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, suiteId: string) => void;
};

export function SuiteSidebar({
  suites,
  selectedSuiteSlug,
  runSummaries,
  externalSets = [],
  onSelectSuite,
  onRunSuite,
  onContextMenu,
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
        {!isCollapsed && hasNoResults && suites.length === 0 && externalSets.length === 0 && (
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
        {!isCollapsed && hasNoResults &&
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

        {filteredSuites.map((suite) =>
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
              isSelected={suite.slug === selectedSuiteSlug}
              runSummary={runSummaries?.get(suite.id)}
              onSelect={() => onSelectSuite(suite.slug)}
              onRun={() => onRunSuite(suite.id)}
              onContextMenu={(e) => onContextMenu(e, suite.id)}
            />
          ),
        )}

        {filteredExternalSets.length > 0 && (
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
  isSelected = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  isSelected?: boolean;
  onClick: () => void;
}) {
  return (
    <HStack
      as="button"
      width="full"
      paddingX={2}
      paddingY={1.5}
      borderRadius="md"
      cursor="pointer"
      bg={isSelected ? "bg.emphasized" : "transparent"}
      _hover={{ bg: isSelected ? "bg.emphasized" : "bg.subtle" }}
      onClick={onClick}
      gap={2}
    >
      {icon}
      <Text fontSize="sm">{label}</Text>
    </HStack>
  );
}

function RunSummaryLine({
  passedCount,
  totalCount,
}: {
  passedCount: number;
  totalCount: number;
}) {
  if (totalCount === 0) return null;
  const passRate = (passedCount / totalCount) * 100;
  return (
    <HStack gap={1} color="fg.muted">
      <PassRateCircle passRate={passRate} size="8px" />
      <Text fontSize="xs" color={getPassRateGradientColor(passRate)} fontWeight="medium">
        {Math.round(passRate)}%
      </Text>
      <Text fontSize="xs" color="fg.muted">·</Text>
      <Text fontSize="xs" color="fg.muted">
        {passedCount} passed
      </Text>
    </HStack>
  );
}

function SidebarListItemWrapper({
  isSelected,
  onClick,
  onContextMenu,
  className,
  "data-testid": dataTestId,
  children,
}: {
  isSelected: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  className?: string;
  "data-testid"?: string;
  children: React.ReactNode;
}) {
  return (
    <HStack
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
      onClick={onClick}
      justify="space-between"
      width="full"
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
      {children}
    </HStack>
  );
}

function SuiteListItem({
  suite,
  isSelected,
  runSummary,
  onSelect,
  onRun,
  onContextMenu,
}: {
  suite: SimulationSuite;
  isSelected: boolean;
  runSummary?: SuiteRunSummary;
  onSelect: () => void;
  onRun: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <SidebarListItemWrapper
      className="group"
      data-testid="suite-list-item"
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
            {suite.name}
          </Text>
          <Spacer />
          {runSummary?.lastRunTimestamp && (
            <Text fontSize="xs" color="fg.subtle" flexShrink={0} whiteSpace="nowrap">
              {formatTimeAgoCompact(runSummary.lastRunTimestamp)}
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
  isSelected,
  onSelect,
}: {
  externalSet: ExternalSetSummary;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <SidebarListItemWrapper
      data-testid="external-set-list-item"
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
            {externalSet.scenarioSetId}
          </Text>
          <Spacer />
          {externalSet.lastRunTimestamp && (
            <Text fontSize="xs" color="fg.subtle" flexShrink={0} whiteSpace="nowrap">
              {formatTimeAgoCompact(externalSet.lastRunTimestamp)}
            </Text>
          )}
        </HStack>
        {externalSet.totalCount > 0 && (
          <RunSummaryLine
            passedCount={externalSet.passedCount}
            totalCount={externalSet.totalCount}
          />
        )}
      </VStack>
    </SidebarListItemWrapper>
  );
}
