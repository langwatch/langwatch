/**
 * Suite detail panel showing header, stats bar, and run results.
 */

import {
  Badge,
  Box,
  Button,
  HStack,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { SimulationSuiteConfiguration } from "@prisma/client";
import {
  FileText,
  Hash,
  Pencil,
  Play,
  RefreshCw,
  Target,
} from "lucide-react";
import { parseSuiteTargets } from "~/server/api/routers/suites/schemas";

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
        </HStack>
      </Box>

      <Separator />

      {/* Results area - placeholder for now */}
      <Box paddingX={6} paddingY={4} flex={1}>
        <Text fontSize="sm" color="fg.muted">
          Run this suite to see results here.
        </Text>
      </Box>
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
export function SuiteEmptyState() {
  return (
    <VStack
      height="100%"
      justify="center"
      align="center"
      color="fg.muted"
      gap={2}
    >
      <Text fontSize="md">Select a suite or create one</Text>
    </VStack>
  );
}
