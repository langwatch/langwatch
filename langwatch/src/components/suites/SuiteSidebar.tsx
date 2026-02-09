/**
 * Suite sidebar with search, new suite button, all runs link, and suite list.
 */

import {
  Box,
  HStack,
  Input,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { SimulationSuiteConfiguration } from "@prisma/client";
import { FolderOpen, List, Play, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

export type SuiteRunSummary = {
  passedCount: number;
  totalCount: number;
  lastRunTimestamp: number | null;
};

type SuiteSidebarProps = {
  suites: SimulationSuiteConfiguration[];
  selectedSuiteId: string | null;
  runSummaries?: Map<string, SuiteRunSummary>;
  onSelectSuite: (id: string) => void;
  onNewSuite: () => void;
  onRunSuite: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, suiteId: string) => void;
};

export function SuiteSidebar({
  suites,
  selectedSuiteId,
  runSummaries,
  onSelectSuite,
  onNewSuite,
  onRunSuite,
  onContextMenu,
}: SuiteSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSuites = useMemo(() => {
    if (!searchQuery.trim()) return suites;
    const query = searchQuery.toLowerCase();
    return suites.filter((s) => s.name.toLowerCase().includes(query));
  }, [suites, searchQuery]);

  return (
    <VStack
      width="280px"
      minWidth="280px"
      height="100%"
      borderRight="1px solid"
      borderColor="border"
      align="stretch"
      gap={0}
      bg="bg.page"
    >
      <Box paddingX={3} paddingTop={3} paddingBottom={2}>
        <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" color="fg.muted">
          Suites
        </Text>
      </Box>

      <Box paddingX={3} paddingBottom={2}>
        <Input
          size="sm"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </Box>

      <Box paddingX={2}>
        <SidebarButton
          icon={<Plus size={14} />}
          label="+ New Suite"
          onClick={onNewSuite}
        />
      </Box>

      <Box paddingX={2}>
        <SidebarButton
          icon={<List size={14} />}
          label="All Runs"
          onClick={() => {}}
        />
      </Box>

      <Separator marginY={1} />

      <VStack
        flex={1}
        overflow="auto"
        paddingX={2}
        paddingBottom={2}
        gap={1}
        align="stretch"
      >
        {filteredSuites.length === 0 && suites.length === 0 && (
          <Text fontSize="sm" color="fg.muted" paddingX={2} paddingY={4} textAlign="center">
            No suites yet
          </Text>
        )}
        {filteredSuites.length === 0 && suites.length > 0 && (
          <Text fontSize="sm" color="fg.muted" paddingX={2} paddingY={4} textAlign="center">
            No matching suites
          </Text>
        )}
        {filteredSuites.map((suite) => (
          <SuiteListItem
            key={suite.id}
            suite={suite}
            isSelected={suite.id === selectedSuiteId}
            runSummary={runSummaries?.get(suite.id)}
            onSelect={() => onSelectSuite(suite.id)}
            onRun={() => onRunSuite(suite.id)}
            onContextMenu={(e) => onContextMenu(e, suite.id)}
          />
        ))}
      </VStack>
    </VStack>
  );
}

function SidebarButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
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
      _hover={{ bg: "bg.subtle" }}
      onClick={onClick}
      gap={2}
    >
      {icon}
      <Text fontSize="sm">{label}</Text>
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
  suite: SimulationSuiteConfiguration;
  isSelected: boolean;
  runSummary?: SuiteRunSummary;
  onSelect: () => void;
  onRun: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <HStack
      paddingX={2}
      paddingY={2}
      borderRadius="md"
      cursor="pointer"
      bg={isSelected ? "bg.emphasized" : "transparent"}
      _hover={{ bg: isSelected ? "bg.emphasized" : "bg.subtle" }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      justify="space-between"
      role="button"
      tabIndex={0}
    >
      <VStack align="start" gap={0} flex={1} overflow="hidden">
        <HStack gap={1.5}>
          <FolderOpen size={14} />
          <Text fontSize="sm" fontWeight="medium" truncate>
            {suite.name}
          </Text>
        </HStack>
        {runSummary && runSummary.totalCount > 0 && (
          <Text fontSize="xs" color="fg.muted" paddingLeft={5}>
            {runSummary.passedCount}/{runSummary.totalCount} passed
            {runSummary.lastRunTimestamp && (
              <> · {formatTimeAgo(runSummary.lastRunTimestamp)}</>
            )}
          </Text>
        )}
      </VStack>
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
        display="flex"
        alignItems="center"
        gap={1}
        flexShrink={0}
      >
        <Play size={12} />
        <Text fontSize="xs">Run</Text>
      </Box>
    </HStack>
  );
}
