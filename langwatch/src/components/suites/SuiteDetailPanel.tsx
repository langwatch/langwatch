/**
 * Suite detail panel showing header, stats bar, and run results.
 */

import {
  Box,
  Button,
  Center,
  EmptyState,
  HStack,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { SimulationSuite } from "@prisma/client";
import {
  BarChart3,
  CheckCircle,
  Clock,
  FileText,
  FolderOpen,
  Layers,
  Pencil,
  Play,
  Plus,
  Repeat2,
  Target,
} from "lucide-react";
import { useState } from "react";
import { parseSuiteTargets } from "~/server/suites/types";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import { RunHistoryList, type RunHistoryStats } from "./RunHistoryList";

type SuiteDetailPanelProps = {
  suite: SimulationSuite;
  onEdit: () => void;
  onRun: () => void;
  isRunning?: boolean;
};

export function SuiteDetailPanel({
  suite,
  onEdit,
  onRun,
  isRunning = false,
}: SuiteDetailPanelProps) {
  const targets = (() => {
    try {
      return parseSuiteTargets(suite.targets);
    } catch {
      return [];
    }
  })();
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
                <Text
                  key={label}
                  fontSize="xs"
                  bg="bg.muted"
                  px={2}
                  py={0.5}
                  borderRadius="md"
                >
                  #{label}
                </Text>
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
            <Button size="sm" colorPalette="blue" onClick={onRun} disabled={isRunning} loading={isRunning}>
              <Play size={14} />
              Run
            </Button>
          </HStack>
        </HStack>
      </Box>

      {/* Stats Bar */}
      <Box paddingX={6} paddingBottom={4}>
        <HStack gap={2} flexWrap="wrap" alignItems="center">
          <StatPill
            icon={<FileText size={14} />}
            value={suite.scenarioIds.length}
            label="scenarios"
            colorScheme="gray"
          />
          <StatPill
            icon={<Target size={14} />}
            value={targets.length}
            label="targets"
            colorScheme="purple"
          />
          <StatPill
            icon={<Repeat2 size={14} />}
            value={`${suite.repeatCount}x`}
            label="trials"
            colorScheme="gray"
          />
          {liveStats && (
            <>
              <Separator
                orientation="vertical"
                height="24px"
                borderColor="border"
              />
              <StatPill
                icon={<Layers size={14} />}
                value={jobCount}
                label="executions"
                colorScheme="gray"
              />
              <StatPill
                icon={<BarChart3 size={14} />}
                value={liveStats.runCount}
                label="runs"
                colorScheme="gray"
              />
              <PassRatePill passRate={liveStats.passRate} />
              {liveStats.lastActivityTimestamp && (
                <StatPill
                  icon={<Clock size={14} />}
                  value={formatTimeAgoCompact(liveStats.lastActivityTimestamp)}
                  label=""
                  colorScheme="gray"
                />
              )}
            </>
          )}
          {!liveStats && (
            <>
              <Separator
                orientation="vertical"
                height="24px"
                borderColor="border"
              />
              <StatPill
                icon={<Layers size={14} />}
                value={jobCount}
                label="executions"
                colorScheme="gray"
              />
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

const pillColors: Record<string, { bg: string; color: string }> = {
  gray: { bg: "gray.50", color: "fg.muted" },
  purple: { bg: "purple.50", color: "purple.600" },
  blue: { bg: "blue.50", color: "blue.600" },
  orange: { bg: "orange.50", color: "orange.600" },
};

function StatPill({
  icon,
  value,
  label,
  colorScheme = "gray",
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  colorScheme?: string;
}) {
  const colors = pillColors[colorScheme] ?? pillColors.gray;
  return (
    <HStack
      gap={1.5}
      paddingX={3}
      paddingY={1.5}
      borderRadius="full"
      bg={colors!.bg}
    >
      <Box color={colors!.color}>{icon}</Box>
      <Text fontSize="sm" fontWeight="semibold">
        {value}
      </Text>
      {label && (
        <Text fontSize="sm" color="fg.muted">
          {label}
        </Text>
      )}
    </HStack>
  );
}

function PassRatePill({ passRate }: { passRate: number }) {
  const rounded = Math.round(passRate);
  return (
    <HStack
      gap={1.5}
      paddingX={3}
      paddingY={1.5}
      borderRadius="full"
      border="1px solid"
      borderColor="border"
      bg="bg"
    >
      <CheckCircle size={14} />
      <Text fontSize="sm" fontWeight="semibold">
        {rounded}%
      </Text>
      <Text fontSize="sm" color="fg.muted">
        pass
      </Text>
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
