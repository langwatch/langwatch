/**
 * Suite detail panel showing header, stats bar, and run results.
 */

import {
  Badge,
  Box,
  Button,
  Center,
  EmptyState,
  HStack,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { SimulationSuiteConfiguration } from "@prisma/client";
import {
  Activity,
  CheckCircle,
  FileText,
  FolderOpen,
  Hash,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Target,
} from "lucide-react";
import { useState } from "react";
import { parseSuiteTargets } from "~/server/suites/types";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { RunHistoryList, type RunHistoryStats } from "./RunHistoryList";

type SuiteDetailPanelProps = {
  suite: SimulationSuiteConfiguration;
  onEdit: () => void;
  onRun: () => void;
};

export function SuiteDetailPanel({
  suite,
  onEdit,
  onRun,
}: SuiteDetailPanelProps) {
  const targets = parseSuiteTargets(suite.targets);
  const jobCount =
    suite.scenarioIds.length * targets.length * suite.repeatCount;

  const [liveStats, setLiveStats] = useState<RunHistoryStats | null>(null);

  return (
    <VStack align="stretch" gap={0} height="100%" overflow="auto">
      {/* Header */}
      <Box paddingX={6} paddingY={4}>
        <HStack justify="space-between" align="start">
          <VStack align="start" gap={1}>
            <HStack gap={2}>
              <Text fontSize="xl" fontWeight="bold">
                {suite.name}
              </Text>
              {suite.labels.map((label) => (
                <Badge key={label} size="sm" variant="outline">
                  {label}
                </Badge>
              ))}
            </HStack>
            {suite.description && (
              <Text fontSize="sm" color="fg.muted">
                {suite.description}
              </Text>
            )}
          </VStack>
          <HStack gap={2}>
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil size={14} />
              Edit
            </Button>
            <Button size="sm" colorPalette="blue" onClick={onRun}>
              <Play size={14} />
              Run
            </Button>
          </HStack>
        </HStack>
      </Box>

      {/* Stats Bar */}
      <Box paddingX={6} paddingBottom={4}>
        <HStack gap={4} flexWrap="wrap">
          <StatChip
            icon={<FileText size={14} />}
            value={suite.scenarioIds.length}
            label="scenarios"
          />
          <StatChip
            icon={<Target size={14} />}
            value={targets.length}
            label="targets"
          />
          <StatChip
            icon={<RefreshCw size={14} />}
            value={`${suite.repeatCount}x`}
            label="trials"
          />
          <StatChip
            icon={<Hash size={14} />}
            value={jobCount}
            label="executions"
          />
          {liveStats && (
            <>
              <StatChip
                icon={<Play size={14} />}
                value={liveStats.runCount}
                label="runs"
              />
              <StatChip
                icon={<CheckCircle size={14} />}
                value={`${Math.round(liveStats.passRate)}%`}
                label="pass rate"
              />
              {liveStats.lastActivityTimestamp && (
                <StatChip
                  icon={<Activity size={14} />}
                  value={formatTimeAgo(liveStats.lastActivityTimestamp) ?? ""}
                  label="last run"
                />
              )}
            </>
          )}
        </HStack>
      </Box>

      <Separator />

      {/* Run history list */}
      <RunHistoryList suite={suite} onStatsReady={setLiveStats} />
    </VStack>
  );
}

function StatChip({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
}) {
  return (
    <HStack
      gap={1.5}
      paddingX={3}
      paddingY={2}
      borderRadius="md"
      border="1px solid"
      borderColor="border"
      bg="bg.subtle"
    >
      {icon}
      <VStack gap={0} align="start">
        <Text fontSize="sm" fontWeight="semibold">
          {value}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {label}
        </Text>
      </VStack>
    </HStack>
  );
}

/** Empty state when no suite is selected */
export function SuiteEmptyState({ onNewSuite }: { onNewSuite: () => void }) {
  return (
    <Center flex={1} height="100%">
      <EmptyState.Root>
        <EmptyState.Content>
          <EmptyState.Indicator>
            <FolderOpen size={32} />
          </EmptyState.Indicator>
          <EmptyState.Title>No suite selected</EmptyState.Title>
          <EmptyState.Description>
            Select a suite from the sidebar or create a new one
          </EmptyState.Description>
          <Button colorPalette="blue" onClick={onNewSuite}>
            <Plus size={16} /> New Suite
          </Button>
        </EmptyState.Content>
      </EmptyState.Root>
    </Center>
  );
}
