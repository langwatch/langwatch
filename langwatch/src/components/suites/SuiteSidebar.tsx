/**
 * Suite sidebar with search, new suite button, all runs link, and suite list.
 */

import {
  Box,
  HStack,
  Separator,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { SimulationSuite } from "@prisma/client";
import {
  CircleAlert,
  CircleCheck,
  List,
  MoreVertical,
  Play,
} from "lucide-react";
import { useMemo, useState } from "react";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import type { SuiteRunSummary } from "./run-history-transforms";
import { SearchInput } from "../ui/SearchInput";

type SuiteSidebarProps = {
  suites: SimulationSuite[];
  selectedSuiteId: string | "all-runs" | null;
  runSummaries?: Map<string, SuiteRunSummary>;
  onSelectSuite: (id: string | "all-runs") => void;
  onRunSuite: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, suiteId: string) => void;
};

export function SuiteSidebar({
  suites,
  selectedSuiteId,
  runSummaries,
  onSelectSuite,
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
    >
      <Box paddingX={3} paddingTop={3} paddingBottom={2}>
        <SearchInput
          size="sm"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </Box>

      <Box paddingX={2}>
        <SidebarButton
          icon={<List size={14} />}
          label="All Runs"
          isSelected={selectedSuiteId === "all-runs"}
          onClick={() => onSelectSuite("all-runs")}
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
          <Text
            fontSize="sm"
            color="fg.muted"
            paddingX={2}
            paddingY={4}
            textAlign="center"
          >
            No suites yet
          </Text>
        )}
        {filteredSuites.length === 0 && suites.length > 0 && (
          <Text
            fontSize="sm"
            color="fg.muted"
            paddingX={2}
            paddingY={4}
            textAlign="center"
          >
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

function StatusIcon({ passed, total }: { passed: number; total: number }) {
  if (total === 0) return null;
  if (passed === total) {
    return (
      <CircleCheck
        size={12}
        color="var(--chakra-colors-green-500)"
        data-testid="status-icon-pass"
      />
    );
  }
  return (
    <CircleAlert
      size={12}
      color="var(--chakra-colors-red-500)"
      data-testid="status-icon-fail"
    />
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
    <HStack
      className="group"
      data-testid="suite-list-item"
      paddingX={3}
      position="relative"
      paddingY={3}
      borderRadius="md"
      cursor="pointer"
      bg={isSelected ? "bg.subtle" : "transparent"}
      border={isSelected ? "1px solid border.emphasized" : "none"}
      _hover={{ bg: isSelected ? "bg.emphasized" : "bg.subtle" }}
      onContextMenu={onContextMenu}
      onClick={onSelect}
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
      <VStack
        align="start"
        gap={0}
        flex={1}
        overflow="hidden"
        textAlign="left"
      >
        <HStack gap={1.5} width="full">
          <Text fontSize="sm" fontWeight="medium" truncate>
            {suite.name}
          </Text>
          <Spacer />
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
              aria-label="Suite options"
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
          <HStack gap={1}>
            <StatusIcon
              passed={runSummary.passedCount}
              total={runSummary.totalCount}
            />
            <Text fontSize="xs">
              {runSummary.passedCount}/{runSummary.totalCount} passed
              {runSummary.lastRunTimestamp && (
                <Text as="span" color="fg.muted">
                  {" · "}
                  {formatTimeAgoCompact(runSummary.lastRunTimestamp)}
                </Text>
              )}
            </Text>
          </HStack>
        )}
      </VStack>
    </HStack>
  );
}
